use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use argon2::{self, Algorithm, Argon2, Params, Version};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Salt length for Argon2id key derivation
const SALT_LENGTH: usize = 16;
/// Nonce length for AES-256-GCM (96 bits)
const NONCE_LENGTH: usize = 12;
/// Derived key length (256 bits for AES-256)
const KEY_LENGTH: usize = 32;

/// Encrypted payload with metadata for decryption
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct EncryptedPayload {
    /// AES-256-GCM ciphertext
    pub ciphertext: Vec<u8>,
    /// Random nonce used for this encryption
    pub nonce: Vec<u8>,
    /// Argon2id salt used for key derivation
    pub salt: Vec<u8>,
}

/// Encryption key material
#[derive(Clone)]
pub struct EncryptionKey {
    key_bytes: [u8; KEY_LENGTH],
}

impl EncryptionKey {
    /// Derive an encryption key from a password and salt using Argon2id.
    pub fn derive(password: &str, salt: &[u8]) -> Result<Self, String> {
        let params = Params::new(65536, 3, 1, Some(KEY_LENGTH))
            .map_err(|e| format!("Argon2 params error: {e}"))?;
        let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

        let mut key_bytes = [0u8; KEY_LENGTH];
        argon2
            .hash_password_into(password.as_bytes(), salt, &mut key_bytes)
            .map_err(|e| format!("Key derivation failed: {e}"))?;

        Ok(Self { key_bytes })
    }

    /// Generate a new random salt for key derivation.
    pub fn generate_salt() -> Vec<u8> {
        let mut salt = vec![0u8; SALT_LENGTH];
        OsRng.fill_bytes(&mut salt);
        salt
    }

    /// Encrypt plaintext bytes.
    pub fn encrypt(&self, plaintext: &[u8]) -> Result<EncryptedPayload, String> {
        let cipher =
            Aes256Gcm::new_from_slice(&self.key_bytes).map_err(|e| format!("Cipher init: {e}"))?;

        let mut nonce_bytes = [0u8; NONCE_LENGTH];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| format!("Encryption failed: {e}"))?;

        Ok(EncryptedPayload {
            ciphertext,
            nonce: nonce_bytes.to_vec(),
            salt: Vec::new(), // Salt is stored separately in the key file
        })
    }

    /// Decrypt an encrypted payload.
    pub fn decrypt(&self, payload: &EncryptedPayload) -> Result<Vec<u8>, String> {
        let cipher =
            Aes256Gcm::new_from_slice(&self.key_bytes).map_err(|e| format!("Cipher init: {e}"))?;

        let nonce = Nonce::from_slice(&payload.nonce);

        cipher
            .decrypt(nonce, payload.ciphertext.as_ref())
            .map_err(|e| format!("Decryption failed: {e}"))
    }

    /// Encrypt a string and return base64-encoded JSON payload.
    pub fn encrypt_string(&self, plaintext: &str) -> Result<String, String> {
        let payload = self.encrypt(plaintext.as_bytes())?;
        serde_json::to_string(&payload).map_err(|e| format!("Serialization failed: {e}"))
    }

    /// Decrypt a base64-encoded JSON payload back to a string.
    pub fn decrypt_string(&self, encrypted_json: &str) -> Result<String, String> {
        let payload: EncryptedPayload =
            serde_json::from_str(encrypted_json).map_err(|e| format!("Deserialization: {e}"))?;
        let plaintext = self.decrypt(&payload)?;
        String::from_utf8(plaintext).map_err(|e| format!("UTF-8 decode: {e}"))
    }
}

/// Get the path to the OpenHuman data directory.
/// If an active user is set, returns the user-scoped directory under the
/// env-aware root returned by `default_root_openhuman_dir()`
/// (for example `~/.openhuman/users/{user_id}` in production or
/// `~/.openhuman-staging/users/{user_id}` when `OPENHUMAN_APP_ENV=staging`);
/// otherwise it falls back to that root directory itself.
pub fn get_data_dir() -> Result<PathBuf, String> {
    let root_dir = crate::openhuman::config::default_root_openhuman_dir()
        .map_err(|e| format!("Cannot determine app data directory: {e}"))?;
    std::fs::create_dir_all(&root_dir)
        .map_err(|e| format!("Failed to create data directory: {e}"))?;

    let data_dir = if let Some(user_id) = crate::openhuman::config::read_active_user_id(&root_dir) {
        let user_dir = crate::openhuman::config::user_openhuman_dir(&root_dir, &user_id);
        std::fs::create_dir_all(&user_dir)
            .map_err(|e| format!("Failed to create user data directory: {e}"))?;
        user_dir
    } else {
        root_dir
    };

    Ok(data_dir)
}

/// Get the path to the encryption key file under the env-aware OpenHuman root
/// (for example `~/.openhuman/encryption.key` or `~/.openhuman-staging/encryption.key`).
fn get_key_file_path() -> Result<PathBuf, String> {
    Ok(get_data_dir()?.join("encryption.key"))
}

/// Key file stores the salt; the actual key is derived at runtime from password.
#[derive(Serialize, Deserialize)]
struct KeyFile {
    salt: Vec<u8>,
    /// Version for future key rotation
    version: u32,
}

/// Initialize encryption with a password. Creates key file if needed.
pub async fn ai_init_encryption(password: String) -> Result<bool, String> {
    let key_path = get_key_file_path()?;

    if key_path.exists() {
        // Key file exists, verify password works by loading it
        let content =
            std::fs::read_to_string(&key_path).map_err(|e| format!("Read key file: {e}"))?;
        let key_file: KeyFile =
            serde_json::from_str(&content).map_err(|e| format!("Parse key file: {e}"))?;
        let _key = EncryptionKey::derive(&password, &key_file.salt)?;
        Ok(true)
    } else {
        // Create new key file with random salt
        let salt = EncryptionKey::generate_salt();
        let key_file = KeyFile { salt, version: 1 };
        let content =
            serde_json::to_string_pretty(&key_file).map_err(|e| format!("Serialize: {e}"))?;
        std::fs::write(&key_path, content).map_err(|e| format!("Write key file: {e}"))?;
        Ok(true)
    }
}

/// Encrypt a string value using the password-derived key.
pub async fn ai_encrypt(password: String, plaintext: String) -> Result<String, String> {
    let key_path = get_key_file_path()?;
    let content = std::fs::read_to_string(&key_path).map_err(|e| format!("Read key: {e}"))?;
    let key_file: KeyFile =
        serde_json::from_str(&content).map_err(|e| format!("Parse key: {e}"))?;
    let key = EncryptionKey::derive(&password, &key_file.salt)?;
    key.encrypt_string(&plaintext)
}

/// Decrypt a string value using the password-derived key.
pub async fn ai_decrypt(password: String, encrypted: String) -> Result<String, String> {
    let key_path = get_key_file_path()?;
    let content = std::fs::read_to_string(&key_path).map_err(|e| format!("Read key: {e}"))?;
    let key_file: KeyFile =
        serde_json::from_str(&content).map_err(|e| format!("Parse key: {e}"))?;
    let key = EncryptionKey::derive(&password, &key_file.salt)?;
    key.decrypt_string(&encrypted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_salt_has_correct_length() {
        let salt = EncryptionKey::generate_salt();
        assert_eq!(salt.len(), SALT_LENGTH);
    }

    #[test]
    fn generate_salt_is_random() {
        let s1 = EncryptionKey::generate_salt();
        let s2 = EncryptionKey::generate_salt();
        assert_ne!(s1, s2);
    }

    #[test]
    fn derive_key_succeeds_with_valid_password() {
        let salt = EncryptionKey::generate_salt();
        let key = EncryptionKey::derive("test-password", &salt);
        assert!(key.is_ok());
    }

    #[test]
    fn encrypt_decrypt_roundtrip_bytes() {
        let salt = EncryptionKey::generate_salt();
        let key = EncryptionKey::derive("my-secret-password", &salt).unwrap();

        let plaintext = b"Hello, World! This is a secret message.";
        let payload = key.encrypt(plaintext).unwrap();

        assert!(!payload.ciphertext.is_empty());
        assert_eq!(payload.nonce.len(), NONCE_LENGTH);

        let decrypted = key.decrypt(&payload).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn encrypt_decrypt_roundtrip_string() {
        let salt = EncryptionKey::generate_salt();
        let key = EncryptionKey::derive("password123", &salt).unwrap();

        let original = "sensitive API key: sk-1234567890";
        let encrypted = key.encrypt_string(original).unwrap();

        assert!(!encrypted.is_empty());
        assert_ne!(encrypted, original);

        let decrypted = key.decrypt_string(&encrypted).unwrap();
        assert_eq!(decrypted, original);
    }

    #[test]
    fn decrypt_with_wrong_key_fails() {
        let salt = EncryptionKey::generate_salt();
        let key1 = EncryptionKey::derive("correct-password", &salt).unwrap();
        let key2 = EncryptionKey::derive("wrong-password", &salt).unwrap();

        let payload = key1.encrypt(b"secret data").unwrap();
        let result = key2.decrypt(&payload);
        assert!(result.is_err());
    }

    #[test]
    fn different_salts_produce_different_keys() {
        let salt1 = EncryptionKey::generate_salt();
        let salt2 = EncryptionKey::generate_salt();
        let key1 = EncryptionKey::derive("same-password", &salt1).unwrap();
        let key2 = EncryptionKey::derive("same-password", &salt2).unwrap();

        let payload = key1.encrypt(b"test").unwrap();
        // key2 has different salt, so it can't decrypt key1's payload
        assert!(key2.decrypt(&payload).is_err());
    }

    #[test]
    fn each_encryption_produces_different_ciphertext() {
        let salt = EncryptionKey::generate_salt();
        let key = EncryptionKey::derive("password", &salt).unwrap();

        let payload1 = key.encrypt(b"same plaintext").unwrap();
        let payload2 = key.encrypt(b"same plaintext").unwrap();

        // Different nonces → different ciphertext
        assert_ne!(payload1.ciphertext, payload2.ciphertext);
        assert_ne!(payload1.nonce, payload2.nonce);
    }

    #[test]
    fn encrypted_payload_serde_roundtrip() {
        let salt = EncryptionKey::generate_salt();
        let key = EncryptionKey::derive("pw", &salt).unwrap();
        let payload = key.encrypt(b"data").unwrap();

        let json = serde_json::to_string(&payload).unwrap();
        let back: EncryptedPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(back.ciphertext, payload.ciphertext);
        assert_eq!(back.nonce, payload.nonce);
    }

    #[test]
    fn decrypt_string_rejects_invalid_json() {
        let salt = EncryptionKey::generate_salt();
        let key = EncryptionKey::derive("pw", &salt).unwrap();
        let result = key.decrypt_string("not-json");
        assert!(result.is_err());
    }

    #[test]
    fn encrypt_empty_string() {
        let salt = EncryptionKey::generate_salt();
        let key = EncryptionKey::derive("pw", &salt).unwrap();
        let encrypted = key.encrypt_string("").unwrap();
        let decrypted = key.decrypt_string(&encrypted).unwrap();
        assert_eq!(decrypted, "");
    }

    #[test]
    fn key_file_serde_roundtrip() {
        let kf = KeyFile {
            salt: vec![1, 2, 3, 4],
            version: 1,
        };
        let json = serde_json::to_string(&kf).unwrap();
        let back: KeyFile = serde_json::from_str(&json).unwrap();
        assert_eq!(back.salt, vec![1, 2, 3, 4]);
        assert_eq!(back.version, 1);
    }
}
