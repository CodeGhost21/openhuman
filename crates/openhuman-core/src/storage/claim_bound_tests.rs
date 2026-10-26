//! A claim-bound handle declares its collections even on a backend whose
//! conditioned handles refuse to, as MongoDB's do (#8422), while a claim
//! that was lost still cannot write.

use std::sync::Arc;

use serde_json::{json, Value};
use tinystoragedrivers::WriteCondition;
use tinystoragedrivers_api::{DocumentStore, Storage};
use tinystoragedrivers_types::{
    Capabilities, Capability, CollectionSpec, Filter, Page, Precondition, Query, Result, Sort,
    StorageError, Version, Versioned, WatchOptions, WriteOptions,
};

use super::claim_bound;
use crate::storage::documents::Repo;
use crate::storage::import_state;
use crate::storage::{Scope, StorageBackend};

const OWNER: &str = "claim_bound_test";
const ROWS: &str = "legacy_rows";

/// A SQLite backend whose conditioned handles refuse collection
/// declarations with MongoDB's error, so the tests reproduce production
/// without a MongoDB server.
#[derive(Debug)]
struct RefusesConditionedDeclarations(Arc<dyn StorageBackend>);

impl StorageBackend for RefusesConditionedDeclarations {
    fn capabilities(&self) -> Capabilities {
        self.0.capabilities()
    }

    fn for_scope(&self, scope: &tinystoragedrivers::Scope) -> Result<Storage> {
        self.0.for_scope(scope)
    }

    fn for_scope_conditioned(
        &self,
        scope: &tinystoragedrivers::Scope,
        condition: &WriteCondition,
    ) -> Result<Storage> {
        let storage = self.0.for_scope_conditioned(scope, condition)?;
        Ok(Storage::new(
            Arc::new(Refusing(Arc::clone(storage.documents()))),
            Arc::clone(storage.streams()),
            Arc::clone(storage.kv()),
            Arc::clone(storage.blobs()),
            Arc::clone(storage.queues()),
            Arc::clone(storage.secrets()),
        ))
    }
}

/// A conditioned document handle that refuses declarations, as MongoDB's
/// driver does.
#[derive(Debug)]
struct Refusing(Arc<dyn DocumentStore>);

#[async_trait::async_trait]
impl DocumentStore for Refusing {
    fn capabilities(&self) -> Capabilities {
        self.0.capabilities()
    }
    async fn ensure_collection(&self, _: &CollectionSpec) -> Result<()> {
        Err(StorageError::unsupported(
            Capability::ConditionalWrites,
            "conditioned MongoDB handles cannot mutate collection declarations",
        ))
    }
    async fn get(&self, c: &str, id: &str) -> Result<Option<Versioned<Value>>> {
        self.0.get(c, id).await
    }
    async fn put(&self, c: &str, id: &str, v: Value, p: Precondition) -> Result<Version> {
        self.0.put(c, id, v, p).await
    }
    async fn put_with(
        &self,
        c: &str,
        id: &str,
        v: Value,
        p: Precondition,
        o: WriteOptions,
    ) -> Result<Version> {
        self.0.put_with(c, id, v, p, o).await
    }
    async fn delete(&self, c: &str, id: &str, p: Precondition) -> Result<bool> {
        self.0.delete(c, id, p).await
    }
    async fn query(&self, c: &str, q: &Query) -> Result<Page<Versioned<Value>>> {
        self.0.query(c, q).await
    }
    async fn count(&self, c: &str, f: &Filter) -> Result<u64> {
        self.0.count(c, f).await
    }
    async fn delete_where(&self, c: &str, f: &Filter) -> Result<u64> {
        self.0.delete_where(c, f).await
    }
    async fn claim(
        &self,
        c: &str,
        f: &Filter,
        s: &[Sort],
        p: &Value,
    ) -> Result<Option<Versioned<Value>>> {
        self.0.claim(c, f, s, p).await
    }
    async fn drop_collection(&self, c: &str) -> Result<()> {
        self.0.drop_collection(c).await
    }
}

/// The refusing backend over a fresh SQLite database, and a repo on it.
fn refusing_repo() -> (tempfile::TempDir, Arc<dyn StorageBackend>, Repo) {
    let dir = tempfile::tempdir().unwrap();
    let url = format!("sqlite:{}", dir.path().join("claims.sqlite").display());
    let sqlite = crate::storage::block_on(async move { crate::storage::open(&url).await }).unwrap();
    let backend: Arc<dyn StorageBackend> = Arc::new(RefusesConditionedDeclarations(sqlite));
    let repo = Repo::on(&backend, &Scope::local(), "claim-bound-test", Vec::new).unwrap();
    (dir, backend, repo)
}

/// Declares [`ROWS`] and writes one row named `id` through `docs`.
async fn declare_and_write(docs: Arc<dyn DocumentStore>, id: &'static str) -> Result<()> {
    docs.ensure_collection(&CollectionSpec::new(ROWS)).await?;
    docs.put(ROWS, id, json!({ "imported": true }), Precondition::Absent)
        .await
        .map(|_| ())
}

fn row(repo: &Repo, id: &'static str) -> Option<Versioned<Value>> {
    repo.run(move |docs| async move { docs.get(ROWS, id).await })
        .unwrap()
}

#[test]
fn the_test_backend_refuses_conditioned_declarations_like_mongodb() {
    let (_dir, backend, repo) = refusing_repo();
    let refused = import_state::with_claim(&repo, OWNER, "sanity", |condition| {
        let storage = backend.for_scope_conditioned(&Scope::local(), condition)?;
        let docs = Arc::clone(storage.documents());
        Ok(crate::storage::block_on(async move {
            docs.ensure_collection(&CollectionSpec::new(ROWS)).await
        }))
    })
    .unwrap()
    .expect("the claim is free");
    let error = refused.expect_err("a conditioned declaration is refused");
    assert!(
        error
            .to_string()
            .contains("cannot mutate collection declarations"),
        "{error}"
    );
}

#[test]
fn a_claimed_repo_declares_its_collections_and_writes() {
    let (_dir, _backend, repo) = refusing_repo();
    import_state::with_claim(&repo, OWNER, "repo", |condition| {
        repo.conditioned(condition)?
            .run(|docs| declare_and_write(docs, "via-repo"))
    })
    .unwrap()
    .expect("the claim is free");
    assert!(row(&repo, "via-repo").is_some());
}

#[test]
fn a_claim_bound_backend_declares_its_collections_and_writes() {
    let (_dir, backend, repo) = refusing_repo();
    import_state::with_claim(&repo, OWNER, "backend", |condition| {
        let bound = import_state::backend_with_condition(Arc::clone(&backend), condition.clone());
        let docs = Arc::clone(bound.for_scope(&Scope::local())?.documents());
        crate::storage::block_on(declare_and_write(docs, "via-backend"))?;
        let composed = bound.for_scope_conditioned(&Scope::local(), condition)?;
        let docs = Arc::clone(composed.documents());
        crate::storage::block_on(declare_and_write(docs, "via-composed"))?;
        Ok(())
    })
    .unwrap()
    .expect("the claim is free");
    assert!(row(&repo, "via-backend").is_some());
    assert!(row(&repo, "via-composed").is_some());
}

#[test]
fn a_lost_claim_may_declare_but_never_writes() {
    let (_dir, backend, repo) = refusing_repo();
    let stale = import_state::with_claim(&repo, OWNER, "lost", |condition| Ok(condition.clone()))
        .unwrap()
        .expect("the claim is free");
    // Released: its condition no longer holds.
    let docs = Arc::clone(
        claim_bound(backend.as_ref(), &Scope::local(), &stale)
            .unwrap()
            .documents(),
    );
    let attempted = crate::storage::block_on(async move {
        docs.ensure_collection(&CollectionSpec::new(ROWS)).await?;
        docs.put(ROWS, "stale", json!({}), Precondition::Absent)
            .await
            .map(|_| ())
    });
    assert!(attempted.is_err(), "a stale claim cannot write");
    assert!(row(&repo, "stale").is_none());
}

#[test]
fn every_other_document_operation_stays_under_the_claim() {
    let (_dir, backend, repo) = refusing_repo();
    import_state::with_claim(&repo, OWNER, "passthrough", |condition| {
        let storage = claim_bound(backend.as_ref(), &Scope::local(), condition)?;
        let docs = Arc::clone(storage.documents());
        assert!(format!("{docs:?}").contains("ClaimBoundDocuments"));
        let claimed = backend.for_scope_conditioned(&Scope::local(), condition)?;
        assert_eq!(docs.capabilities(), claimed.documents().capabilities());
        crate::storage::block_on(async move {
            let spec = CollectionSpec::new(ROWS);
            docs.ensure_collection(&spec).await?;
            let _ = docs.validate_collection_spec(&spec).await;
            docs.put(ROWS, "a", json!({ "n": 1 }), Precondition::Absent)
                .await?;
            docs.put_with(
                ROWS,
                "b",
                json!({ "n": 2 }),
                Precondition::Absent,
                WriteOptions::new(),
            )
            .await?;
            assert!(docs.get(ROWS, "a").await?.is_some());
            assert_eq!(docs.count(ROWS, &Filter::All).await?, 2);
            assert_eq!(docs.query(ROWS, &Query::all()).await?.items.len(), 2);
            assert!(docs.delete(ROWS, "a", Precondition::None).await?);
            let _ = docs
                .claim(ROWS, &Filter::All, &[], &json!({ "n": 3 }))
                .await;
            let _ = docs.atomic_batch(Vec::new()).await;
            let _ = docs.atomic_batch_checked(Vec::new(), Vec::new()).await;
            let _ = docs.search(ROWS, "n", 1).await;
            let _ = docs.collections("").await;
            let _ = docs
                .watch(ROWS, &Filter::All, &WatchOptions::default())
                .await;
            assert_eq!(docs.delete_where(ROWS, &Filter::All).await?, 1);
            docs.drop_collection(ROWS).await?;
            Ok::<_, StorageError>(())
        })?;
        Ok(())
    })
    .unwrap()
    .expect("the claim is free");
}
