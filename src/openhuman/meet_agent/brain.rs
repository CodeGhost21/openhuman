//! Turn orchestration: STT → LLM → TTS.
//!
//! ## Pipeline
//!
//! When [`session::Vad`] reports `EndOfUtterance`, [`run_turn`] drains
//! the inbound buffer and runs three serial stages:
//!
//! 1. **STT** — wrap the PCM16LE samples in a WAV container and post
//!    to [`crate::openhuman::voice::cloud_transcribe`]. Returns the
//!    transcribed text (or `Err` on transport / auth failure).
//!
//! 2. **LLM** — send a tiny chat-completions request through
//!    [`crate::api::BackendOAuthClient`] with a "live meeting agent"
//!    system prompt and the transcript as the user message. Returns a
//!    short reply (or empty string when the agent decides to stay
//!    silent).
//!
//! 3. **TTS** — feed the reply text into
//!    [`crate::openhuman::voice::reply_speech`] requesting
//!    `output_format = "pcm_16000"`. Decode the base64 PCM bytes back
//!    into `Vec<i16>` and enqueue on the session's outbound queue.
//!
//! ## Fallback
//!
//! There are four paths through the Err arms of the LLM and TTS stages:
//!
//!   1. **billing-blocked short-circuit** — if `session.billing_blocked` is
//!      already `true` (set on a prior turn), both `run_turn` and
//!      `run_caption_turn` return `Ok(false)` immediately. No LLM/TTS calls.
//!
//!   2. **BillingConfigMissing (HTTP 402)** — the account is not provisioned.
//!      Speak ONE hardcoded explanatory message via TTS. If TTS also 402s,
//!      skip speech entirely (no stub beep). Set `billing_blocked = true`.
//!      Record a Note with code. NEVER fall through to `stub_tts`.
//!
//!   3. **Server error / transport (5xx, transport)** — degrade to
//!      `pick_ack_phrase + stub_tts` but cap retries at 3 per session. After
//!      the cap, switch to billing-blocked behaviour (different Note text:
//!      "backend_unavailable").
//!
//!   4. **Other (4xx, empty LLM response)** — existing `pick_ack_phrase +
//!      stub_tts` fallback. Log the error code if present.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde_json::{json, Value};

use super::session::registry;
use super::types::{SessionEvent, SessionEventKind};
use super::wav;
use crate::api::error::{BackendApiError, BillingErrorCode};

/// How many of the most recent `Heard` / `Spoke` events we feed back
/// into the LLM as rolling conversation context. 12 ≈ a few minutes of
/// captioned dialogue — enough for the model to follow a thread without
/// blowing the prompt budget.
const CONTEXT_EVENT_WINDOW: usize = 12;
/// Spoken-reply ceiling. Each token is roughly ¾ of a word, so 220
/// tokens ≈ 30 seconds of speech — long enough for a real answer, short
/// enough that the model can't hijack the meeting.
const REPLY_MAX_TOKENS: u32 = 220;
/// ElevenLabs model. `eleven_turbo_v2_5` strikes the best
/// quality/latency balance; the older default the backend would pick
/// (`eleven_monolingual_v1`) sounds noticeably flatter.
const TTS_MODEL_ID: &str = "eleven_turbo_v2_5";

/// Minimum samples below which we skip the brain turn entirely.
/// 250 ms @ 16 kHz — under this, VAD almost certainly fired on a
/// transient (cough, click) rather than real speech.
const MIN_TURN_SAMPLES: usize = 4_000;
/// Re-exported from `ops` so any drift (if we ever loosen the
/// boundary check) immediately breaks the WAV / duration math here
/// at compile time. Today the same constant is used in both places —
/// the ops boundary check rejects anything else outright.
const SAMPLE_RATE_HZ: u32 = super::ops::REQUIRED_SAMPLE_RATE;

/// How many consecutive server/transport errors before the session is paused.
/// After this many failures the session behaves like a billing-blocked session
/// (no further LLM/TTS calls) until restarted.
const SERVER_ERR_CAP: u32 = 3;

/// Hardcoded TTS message spoken exactly once when billing_config_missing
/// is returned by the LLM endpoint. This is a pre-composed string so we do
/// NOT call back to the failing endpoint for the message text.
const BILLING_BLOCKED_MESSAGE: &str =
    "My account isn't set up to talk yet — please check the OpenHuman dashboard.";

/// Hardcoded TTS message spoken once when the server-error cap is hit.
const BACKEND_UNAVAILABLE_MESSAGE: &str =
    "I'm having trouble reaching the server — please try again later.";

/// Caption-driven turn. Drains the session's pending wake-word prompt
/// (assembled by `session::note_caption`) and runs LLM → TTS → enqueue
/// outbound. Skips STT entirely — the captions are already text.
///
/// We give the user a short window (`CAPTION_TURN_DELAY_MS`) after the
/// wake word fires so multi-caption utterances ("hey openhuman …
/// what's the weather like in paris") have a chance to assemble
/// before we hit the LLM. The shell calls this on every caption
/// push that flagged the wake word; subsequent calls before the
/// delay expires are coalesced via the session's `wake_active` flag.
pub async fn run_caption_turn(request_id: &str) -> Result<bool, String> {
    // ── 0. Billing-blocked short-circuit ────────────────────────────────────
    // If a prior turn hit a billing error or exhausted server retries, we
    // skip all backend calls immediately. The user must re-auth or restart.
    let already_blocked = registry().with_session(request_id, |s| s.billing_blocked)?;
    if already_blocked {
        log::info!(
            "[meet-agent] caption turn skipped request_id={request_id} reason=billing_blocked"
        );
        return Ok(false);
    }

    // Wait briefly so a multi-fragment wake utterance ("hey openhuman
    // what's the weather like in paris" arriving as 2-3 captions) has
    // a chance to assemble before we drain the prompt.
    tokio::time::sleep(std::time::Duration::from_millis(CAPTION_TURN_DELAY_MS)).await;

    let (raw_prompt, history) = match registry().with_session(request_id, |s| {
        let prompt = s.take_pending_prompt();
        let history = recent_dialog_history(s.events(), CONTEXT_EVENT_WINDOW);
        (prompt, history)
    })? {
        (Some(p), h) => (Some(p), h),
        (None, h) => (None, h),
    };
    // Wake-only utterance ("hey openhuman" with no follow-up) still
    // needs an audible response so the speaker knows the agent heard
    // them. We mark the prompt as empty and let the LLM stage
    // short-circuit to a greeting ack rather than going silent.
    let (prompt, prompt_was_empty) = match raw_prompt {
        Some(p) if !p.trim().is_empty() => (p, false),
        _ => (String::new(), true),
    };
    log::info!(
        "[meet-agent] caption turn start request_id={request_id} prompt_chars={} history_msgs={} wake_only={prompt_was_empty}",
        prompt.chars().count(),
        history.len(),
    );

    // Decide what to say. The LLM result is dispatched into one of four arms:
    //
    //   1. Wake-only ("hey openhuman" alone): skip the LLM, greet.
    //   2. LLM call fails with billing error: speak hardcoded message, block.
    //   3. LLM call fails with server/transport error: ack + stub_tts, cap 3.
    //   4. LLM call fails with other error or returns empty: pick_ack_phrase.
    //   5. LLM call succeeds: use the returned text.
    let tts_outcome = if prompt_was_empty {
        log::info!("[meet-agent] caption turn wake-only request_id={request_id} — greeting ack");
        let _ = registry().with_session(request_id, |s| {
            s.record_event(
                SessionEventKind::Note,
                "wake-only utterance — greeting ack".to_string(),
            );
        });
        TtsDecision::Speak(WAKE_ONLY_ACK.to_string())
    } else {
        match llm_meeting(&prompt, &history).await {
            Ok(text) if !text.trim().is_empty() => TtsDecision::Speak(text),
            Ok(_) => {
                // Model intentionally returned nothing despite the
                // updated system prompt that tells it to always reply.
                log::warn!(
                    "[meet-agent] caption-turn LLM returned empty request_id={request_id} code=empty — falling back to ack"
                );
                let _ = registry().with_session(request_id, |s| {
                    s.record_event(
                        SessionEventKind::Note,
                        "LLM returned empty (using ack)".to_string(),
                    );
                });
                TtsDecision::StubAck(pick_ack_phrase(&prompt).to_string())
            }
            Err(LlmError::Backend(BackendApiError::Billing(
                BillingErrorCode::BillingConfigMissing,
                ref msg,
            ))) => {
                let code = BillingErrorCode::BillingConfigMissing.as_str();
                let status = 402u16;
                log::warn!(
                    "[meet-agent] caption-turn LLM failed request_id={request_id} \
                     stage=llm code={code} status={status} msg={msg}"
                );
                TtsDecision::BillingBlocked
            }
            Err(LlmError::Backend(BackendApiError::Server {
                ref code,
                ref message,
                status,
            })) => {
                let code_str = code.as_deref().unwrap_or("unknown");
                log::warn!(
                    "[meet-agent] caption-turn LLM failed request_id={request_id} \
                     stage=llm code={code_str} status={status} msg={message}"
                );
                let _ = registry().with_session(request_id, |s| {
                    s.record_event(
                        SessionEventKind::Note,
                        format!("LLM server error (using ack): code={code_str} status={status}"),
                    );
                });
                TtsDecision::ServerError(pick_ack_phrase(&prompt).to_string())
            }
            Err(LlmError::Backend(BackendApiError::Transport(ref e))) => {
                log::warn!(
                    "[meet-agent] caption-turn LLM transport failed request_id={request_id} \
                     stage=llm code=transport msg={e}"
                );
                let _ = registry().with_session(request_id, |s| {
                    s.record_event(
                        SessionEventKind::Note,
                        format!("LLM transport error (using ack): {e}"),
                    );
                });
                TtsDecision::ServerError(pick_ack_phrase(&prompt).to_string())
            }
            Err(LlmError::Backend(BackendApiError::Client {
                status,
                ref code,
                ref message,
                retry_after_secs,
            })) => {
                let code_str = code.as_deref().unwrap_or("unknown");
                log::warn!(
                    "[meet-agent] caption-turn LLM failed request_id={request_id} \
                     stage=llm code={code_str} status={status} msg={message}"
                );
                if status == 429 {
                    if let Some(secs) = retry_after_secs {
                        log::info!(
                            "[meet-agent] caption-turn 429 rate-limit request_id={request_id} \
                             retry_after={secs}s"
                        );
                        tokio::time::sleep(std::time::Duration::from_secs(secs as u64)).await;
                    }
                    TtsDecision::StubAck("Give me a moment.".to_string())
                } else {
                    let _ = registry().with_session(request_id, |s| {
                        s.record_event(
                            SessionEventKind::Note,
                            format!(
                                "LLM client error (using ack): code={code_str} status={status}"
                            ),
                        );
                    });
                    TtsDecision::StubAck(pick_ack_phrase(&prompt).to_string())
                }
            }
            Err(LlmError::Backend(BackendApiError::Billing(ref code, ref msg))) => {
                let code_str = code.as_str();
                log::warn!(
                    "[meet-agent] caption-turn LLM billing failed request_id={request_id} \
                     stage=llm code={code_str} msg={msg}"
                );
                TtsDecision::BillingBlocked
            }
            Err(LlmError::Precondition(ref msg)) => {
                // Missing token / config error — treated like server error
                // (most likely "no backend session token" in tests).
                log::warn!(
                    "[meet-agent] caption-turn LLM precondition failed request_id={request_id} \
                     stage=llm code=precondition msg={msg}"
                );
                let _ = registry().with_session(request_id, |s| {
                    s.record_event(
                        SessionEventKind::Note,
                        format!("LLM precondition failure (using ack): {msg}"),
                    );
                });
                TtsDecision::StubAck(pick_ack_phrase(&prompt).to_string())
            }
        }
    };

    // ── TTS dispatch ─────────────────────────────────────────────────────────
    let (reply_text, synthesized) = execute_tts_decision(request_id, tts_outcome).await?;

    registry().with_session(request_id, |s| {
        // Record the user-side text for rolling history. For wake-only
        // utterances we record a placeholder so the assistant's reply
        // still has a paired user turn in the history window.
        let heard_text = if prompt_was_empty {
            "(wake word, no follow-up)".to_string()
        } else {
            prompt.clone()
        };
        s.record_event(SessionEventKind::Heard, heard_text);
        if !reply_text.is_empty() {
            s.record_event(SessionEventKind::Spoke, reply_text.clone());
            if !synthesized.is_empty() {
                s.enqueue_outbound_pcm(&synthesized, true);
            }
        } else {
            s.record_event(
                SessionEventKind::Note,
                "agent declined to respond".to_string(),
            );
        }
        s.turn_count += 1;
    })?;

    log::info!(
        "[meet-agent] caption turn done request_id={request_id} reply_chars={} synth_samples={}",
        reply_text.chars().count(),
        synthesized.len()
    );
    Ok(true)
}

/// Delay between wake-word match and prompt drain. Long enough that
/// 2-3 caption fragments can join up; short enough that the user
/// doesn't experience awkward silence after they stop talking.
const CAPTION_TURN_DELAY_MS: u64 = 1_500;

/// Spoken reply when the user fired the wake word but said nothing
/// afterwards. Brief and friendly so they immediately know the agent
/// is listening.
const WAKE_ONLY_ACK: &str = "I'm here — what would you like?";

/// Canned acknowledgements the agent speaks out loud after capturing
/// a note. Short, varied so consecutive notes don't sound robotic.
/// Selected by hashing the prompt so the same dictation reliably
/// produces the same ack (helpful for tests + debugging) while still
/// rotating across the set in a normal conversation.
const ACK_PHRASES: &[&str] = &["Got it.", "Noted.", "Adding that.", "On it.", "Captured."];

fn pick_ack_phrase(prompt: &str) -> &'static str {
    if prompt.trim().is_empty() {
        return "";
    }
    let h: u32 = prompt.bytes().fold(0u32, |a, b| a.wrapping_add(b as u32));
    ACK_PHRASES[(h as usize) % ACK_PHRASES.len()]
}

/// Internal enum that captures the TTS outcome decision made during the
/// LLM dispatch phase. Separates "what to say" from "how to say it" and
/// makes the billing-blocked path explicit so it can never accidentally
/// fall through to `stub_tts`.
enum TtsDecision {
    /// Speak this text via real TTS; fall through to `stub_tts` on transient
    /// TTS failures.
    Speak(String),
    /// Use a stub-TTS ack (pick_ack_phrase path — 4xx or empty response).
    StubAck(String),
    /// Server/transport error on the LLM stage. The embedded text is the
    /// ack phrase. Increments `server_err_count`; on cap switch to blocked.
    ServerError(String),
    /// BillingConfigMissing — speak ONE hardcoded message, then block.
    /// NEVER fall through to stub_tts.
    BillingBlocked,
}

/// Execute the TTS decision and return `(reply_text, pcm_samples)`. Updates
/// `session.billing_blocked` and `session.server_err_count` as a side-effect.
async fn execute_tts_decision(
    request_id: &str,
    decision: TtsDecision,
) -> Result<(String, Vec<i16>), String> {
    match decision {
        TtsDecision::Speak(reply_text) => {
            // ── Real TTS path. On success, reset server error counter. ──
            match tts(&reply_text).await {
                Ok(samples) => {
                    // Reset server error counter on TTS success.
                    let _ = registry().with_session(request_id, |s| {
                        s.server_err_count = 0;
                    });
                    Ok((reply_text, samples))
                }
                Err(TtsError::Backend(BackendApiError::Billing(
                    BillingErrorCode::BillingConfigMissing,
                    ref msg,
                ))) => {
                    let code = BillingErrorCode::BillingConfigMissing.as_str();
                    log::warn!(
                        "[meet-agent] TTS billing-blocked request_id={request_id} \
                         stage=tts code={code} msg={msg} — going silent (no stub beep)"
                    );
                    let _ = registry().with_session(request_id, |s| {
                        s.billing_blocked = true;
                        s.record_event(
                            SessionEventKind::Note,
                            format!(
                                "{code} — agent paused for this session (TTS also billing-blocked)"
                            ),
                        );
                        // TODO(#1372-followup): wire desktop notification via event_bus
                        // once a UserNotification DomainEvent lands.
                    });
                    // No audio — session is blocked. User finds out via logs.
                    Ok((String::new(), Vec::new()))
                }
                Err(TtsError::Backend(BackendApiError::Server {
                    ref code,
                    ref message,
                    status,
                })) => {
                    let code_str = code.as_deref().unwrap_or("unknown");
                    log::warn!(
                        "[meet-agent] TTS failed request_id={request_id} \
                         stage=tts code={code_str} status={status} msg={message} — using stub"
                    );
                    let _ = registry().with_session(request_id, |s| {
                        s.record_event(
                            SessionEventKind::Note,
                            format!(
                                "TTS server error (using stub): code={code_str} status={status}"
                            ),
                        );
                    });
                    Ok((reply_text.clone(), stub_tts(&reply_text).await))
                }
                Err(TtsError::Backend(BackendApiError::Transport(ref e))) => {
                    log::warn!(
                        "[meet-agent] TTS transport failed request_id={request_id} \
                         stage=tts code=transport msg={e} — using stub"
                    );
                    let _ = registry().with_session(request_id, |s| {
                        s.record_event(
                            SessionEventKind::Note,
                            format!("TTS transport error (using stub): {e}"),
                        );
                    });
                    Ok((reply_text.clone(), stub_tts(&reply_text).await))
                }
                Err(TtsError::Backend(ref e)) => {
                    log::warn!(
                        "[meet-agent] TTS failed request_id={request_id} \
                         stage=tts code=other err={e} — using stub"
                    );
                    let _ = registry().with_session(request_id, |s| {
                        s.record_event(
                            SessionEventKind::Note,
                            format!("TTS failure (using stub): {e}"),
                        );
                    });
                    Ok((reply_text.clone(), stub_tts(&reply_text).await))
                }
                Err(TtsError::Precondition(ref msg)) => {
                    log::warn!(
                        "[meet-agent] TTS precondition failed request_id={request_id} \
                         stage=tts code=precondition msg={msg} — using stub"
                    );
                    let _ = registry().with_session(request_id, |s| {
                        s.record_event(
                            SessionEventKind::Note,
                            format!("TTS precondition failure (using stub): {msg}"),
                        );
                    });
                    Ok((reply_text.clone(), stub_tts(&reply_text).await))
                }
                Err(TtsError::Decode(ref msg)) => {
                    log::warn!(
                        "[meet-agent] TTS decode failed request_id={request_id} \
                         stage=tts code=decode msg={msg} — using stub"
                    );
                    let _ = registry().with_session(request_id, |s| {
                        s.record_event(
                            SessionEventKind::Note,
                            format!("TTS decode failure (using stub): {msg}"),
                        );
                    });
                    Ok((reply_text.clone(), stub_tts(&reply_text).await))
                }
            }
        }

        TtsDecision::StubAck(ack_text) => {
            // 4xx / empty LLM — speak ack via stub, log code.
            if ack_text.is_empty() {
                return Ok((String::new(), Vec::new()));
            }
            let samples = stub_tts(&ack_text).await;
            Ok((ack_text, samples))
        }

        TtsDecision::ServerError(ack_text) => {
            // 5xx / transport from LLM — increment counter, maybe block.
            let (count_after, now_blocked) = registry().with_session(request_id, |s| {
                s.server_err_count += 1;
                (s.server_err_count, s.server_err_count >= SERVER_ERR_CAP)
            })?;

            if now_blocked {
                // Exhausted retries — speak the unavailability message once,
                // then block (same path as billing, different message + note).
                log::warn!(
                    "[meet-agent] server error cap hit request_id={request_id} \
                     count={count_after} — pausing session (backend_unavailable)"
                );
                let unavail_msg = BACKEND_UNAVAILABLE_MESSAGE.to_string();

                // Attempt TTS for the unavailability message.
                let samples = match tts(&unavail_msg).await {
                    Ok(s) => s,
                    Err(e) => {
                        // If TTS also fails, go silent (don't stub_tts).
                        log::warn!(
                            "[meet-agent] TTS for unavail message also failed \
                             request_id={request_id} err={e} — going silent"
                        );
                        Vec::new()
                    }
                };

                let _ = registry().with_session(request_id, |s| {
                    s.billing_blocked = true; // reuse the flag for "paused"
                    s.record_event(
                        SessionEventKind::Note,
                        "backend_unavailable — agent paused for this session".to_string(),
                    );
                    // TODO(#1372-followup): wire desktop notification via event_bus
                    // once a UserNotification DomainEvent lands.
                });

                Ok((unavail_msg, samples))
            } else {
                // Still within retry budget — speak the ack via stub.
                log::info!(
                    "[meet-agent] server error request_id={request_id} \
                     count={count_after}/{SERVER_ERR_CAP} — using ack stub"
                );
                let _ = registry().with_session(request_id, |s| {
                    s.record_event(
                        SessionEventKind::Note,
                        format!(
                            "LLM server error (using ack stub): count={count_after}/{SERVER_ERR_CAP}"
                        ),
                    );
                });
                if ack_text.is_empty() {
                    return Ok((String::new(), Vec::new()));
                }
                let samples = stub_tts(&ack_text).await;
                Ok((ack_text, samples))
            }
        }

        TtsDecision::BillingBlocked => {
            // BillingConfigMissing — speak ONE hardcoded message via TTS,
            // then block. NEVER fall through to stub_tts.
            log::warn!(
                "[meet-agent] billing blocked request_id={request_id} \
                 — speaking hardcoded message and pausing session"
            );

            let hardcoded = BILLING_BLOCKED_MESSAGE.to_string();
            let samples = match tts(&hardcoded).await {
                Ok(s) => s,
                Err(e) => {
                    // TTS also billing-blocked (or any error) — go silent.
                    // IMPORTANT: do NOT call stub_tts here; beeping is
                    // the symptom we're fixing (issue #1372).
                    log::warn!(
                        "[meet-agent] billing-blocked TTS also failed request_id={request_id} \
                         err={e} — going silent (no stub beep)"
                    );
                    Vec::new()
                }
            };

            let _ = registry().with_session(request_id, |s| {
                s.billing_blocked = true;
                s.record_event(
                    SessionEventKind::Note,
                    "billing_config_missing — agent paused for this session".to_string(),
                );
                // TODO(#1372-followup): wire desktop notification via event_bus
                // once a UserNotification DomainEvent lands.
            });

            Ok((hardcoded, samples))
        }
    }
}

/// Fire one brain turn for the named session. Returns `Ok(true)` when a
/// turn actually ran, `Ok(false)` when the inbound buffer was below the
/// floor.
pub async fn run_turn(request_id: &str) -> Result<bool, String> {
    // ── 0. Billing-blocked short-circuit ────────────────────────────────────
    // If a prior turn hit a billing error or exhausted server retries, we
    // skip all backend calls immediately. The user must re-auth or restart.
    let already_blocked = registry().with_session(request_id, |s| s.billing_blocked)?;
    if already_blocked {
        log::info!("[meet-agent] turn skipped request_id={request_id} reason=billing_blocked");
        return Ok(false);
    }

    let (drained, history) = registry().with_session(request_id, |s| {
        let drained = s.drain_inbound();
        let history = recent_dialog_history(s.events(), CONTEXT_EVENT_WINDOW);
        (drained, history)
    })?;
    if drained.len() < MIN_TURN_SAMPLES {
        log::debug!(
            "[meet-agent] skipping turn request_id={request_id} samples={}",
            drained.len()
        );
        return Ok(false);
    }

    log::info!(
        "[meet-agent] turn start request_id={request_id} samples={}",
        drained.len()
    );

    // ─── STT ────────────────────────────────────────────────────────
    let heard = match stt(&drained).await {
        Ok(text) if text.trim().is_empty() => {
            log::info!("[meet-agent] STT empty, skipping turn request_id={request_id}");
            return Ok(false);
        }
        Ok(text) => text,
        Err(err) => {
            log::warn!("[meet-agent] STT failed request_id={request_id} err={err}");
            // Record a Note so the transcript log makes the failure
            // visible to whoever's looking at logs.
            let _ = registry().with_session(request_id, |s| {
                s.record_event(
                    SessionEventKind::Note,
                    format!("STT failure (using stub): {err}"),
                );
            });
            stub_stt(&drained).await
        }
    };
    log::info!(
        "[meet-agent] STT request_id={request_id} text_chars={}",
        heard.chars().count()
    );

    // ─── LLM ────────────────────────────────────────────────────────
    let tts_decision = match llm_meeting(&heard, &history).await {
        Ok(text) if !text.trim().is_empty() => TtsDecision::Speak(text),
        Ok(_) => TtsDecision::StubAck(stub_llm(&heard).await),
        Err(LlmError::Backend(BackendApiError::Billing(
            BillingErrorCode::BillingConfigMissing,
            ref msg,
        ))) => {
            let code = BillingErrorCode::BillingConfigMissing.as_str();
            let status = 402u16;
            log::warn!(
                "[meet-agent] turn LLM failed request_id={request_id} \
                 stage=llm code={code} status={status} msg={msg}"
            );
            TtsDecision::BillingBlocked
        }
        Err(LlmError::Backend(BackendApiError::Server {
            ref code,
            ref message,
            status,
        })) => {
            let code_str = code.as_deref().unwrap_or("unknown");
            log::warn!(
                "[meet-agent] turn LLM failed request_id={request_id} \
                 stage=llm code={code_str} status={status} msg={message}"
            );
            let _ = registry().with_session(request_id, |s| {
                s.record_event(
                    SessionEventKind::Note,
                    format!("LLM server error (using stub): code={code_str} status={status}"),
                );
            });
            TtsDecision::ServerError(pick_ack_phrase(&heard).to_string())
        }
        Err(LlmError::Backend(BackendApiError::Transport(ref e))) => {
            log::warn!(
                "[meet-agent] turn LLM transport failed request_id={request_id} \
                 stage=llm code=transport msg={e}"
            );
            let _ = registry().with_session(request_id, |s| {
                s.record_event(
                    SessionEventKind::Note,
                    format!("LLM transport error (using stub): {e}"),
                );
            });
            TtsDecision::ServerError(pick_ack_phrase(&heard).to_string())
        }
        Err(LlmError::Backend(BackendApiError::Client {
            status,
            ref code,
            ref message,
            retry_after_secs,
        })) => {
            let code_str = code.as_deref().unwrap_or("unknown");
            log::warn!(
                "[meet-agent] turn LLM failed request_id={request_id} \
                 stage=llm code={code_str} status={status} msg={message}"
            );
            if status == 429 {
                if let Some(secs) = retry_after_secs {
                    log::info!(
                        "[meet-agent] turn 429 rate-limit request_id={request_id} \
                         retry_after={secs}s"
                    );
                    tokio::time::sleep(std::time::Duration::from_secs(secs as u64)).await;
                }
                TtsDecision::StubAck("Give me a moment.".to_string())
            } else {
                let _ = registry().with_session(request_id, |s| {
                    s.record_event(
                        SessionEventKind::Note,
                        format!("LLM client error (using stub): code={code_str} status={status}"),
                    );
                });
                TtsDecision::StubAck(pick_ack_phrase(&heard).to_string())
            }
        }
        Err(LlmError::Backend(BackendApiError::Billing(ref code, ref msg))) => {
            let code_str = code.as_str();
            log::warn!(
                "[meet-agent] turn LLM billing failed request_id={request_id} \
                 stage=llm code={code_str} msg={msg}"
            );
            TtsDecision::BillingBlocked
        }
        Err(LlmError::Precondition(ref msg)) => {
            // Missing token / config error — treated like server error.
            log::warn!(
                "[meet-agent] turn LLM precondition failed request_id={request_id} \
                 stage=llm code=precondition msg={msg}"
            );
            let _ = registry().with_session(request_id, |s| {
                s.record_event(
                    SessionEventKind::Note,
                    format!("LLM precondition failure (using stub): {msg}"),
                );
            });
            TtsDecision::StubAck(stub_llm(&heard).await)
        }
    };

    // ─── TTS (via execute_tts_decision) ─────────────────────────────
    let (reply_text, synthesized) = execute_tts_decision(request_id, tts_decision).await?;

    registry().with_session(request_id, |s| {
        s.record_event(SessionEventKind::Heard, heard.clone());
        if !reply_text.is_empty() {
            s.record_event(SessionEventKind::Spoke, reply_text.clone());
            if !synthesized.is_empty() {
                s.enqueue_outbound_pcm(&synthesized, true);
            }
        } else {
            s.record_event(
                SessionEventKind::Note,
                "agent declined to respond".to_string(),
            );
        }
        s.turn_count += 1;
    })?;

    log::info!(
        "[meet-agent] turn done request_id={request_id} reply_chars={} synth_samples={}",
        reply_text.chars().count(),
        synthesized.len()
    );
    Ok(true)
}

// ─── Real adapters ──────────────────────────────────────────────────

async fn stt(samples: &[i16]) -> Result<String, String> {
    use crate::openhuman::voice::cloud_transcribe::{transcribe_cloud, CloudTranscribeOptions};

    let config = crate::openhuman::config::ops::load_config_with_timeout().await?;
    let wav_bytes = wav::pack_pcm16le_mono_wav(samples, SAMPLE_RATE_HZ);
    let audio_b64 = B64.encode(&wav_bytes);
    let opts = CloudTranscribeOptions {
        mime_type: Some("audio/wav".to_string()),
        file_name: Some("meet-agent.wav".to_string()),
        ..Default::default()
    };
    let outcome = transcribe_cloud(&config, &audio_b64, &opts).await?;
    let text = outcome.value.text.clone();
    Ok(text)
}

/// System prompt for the live meeting agent. The wake-word gate has
/// already decided the message is for us by the time this runs (see
/// `session::note_caption`), so the model's job is *only* to respond
/// well — not to re-decide whether to engage. Asking the model to
/// re-detect addressing causes silent drops, because the wake phrase
/// has been stripped from the prompt before the LLM sees it.
const MEETING_SYSTEM_PROMPT: &str = "\
You are OpenHuman, an AI assistant joining a live Google Meet call as a participant. \
The meeting transcript is provided as prior turns where `user` lines are captions \
spoken by humans on the call (sometimes prefixed with their name) and `assistant` \
lines are things you previously said out loud.\n\
\n\
The latest `user` message is a request directly addressed to you. The user said a \
wake phrase (\"hey OpenHuman\") that has already been stripped, so what you receive \
is the body of their request. Always respond — do not return an empty string. \
Even short or ambiguous prompts deserve a brief acknowledgement so the speaker \
hears that you're engaged.\n\
\n\
How to reply:\n\
  • 1–2 spoken sentences. Conversational, warm, direct. No filler.\n\
  • Pronounce naturally — write the way a person speaks, not the way they type. \
No markdown, no bullet lists, no code blocks, no emoji.\n\
  • If the prompt is empty, very short, or unclear, give a brief friendly \
acknowledgement (\"I'm here.\", \"Listening — what would you like?\") so the \
caller knows you heard them.\n\
  • For dictation / note requests (\"remember…\", \"action item…\", \"follow up on…\"), \
acknowledge briefly (\"Got it.\", \"Adding that.\") — don't read the note back.\n\
  • For questions, answer directly with what you know; if you don't know, say so \
in one sentence rather than guessing.\n\
  • Never repeat verbatim what was said. Never describe what you're about to do — \
just do it.\n\
";

/// Typed error from the LLM stage.
#[derive(Debug)]
enum LlmError {
    /// Pre-flight failure: missing token, config parse error, client build.
    Precondition(String),
    /// HTTP/transport error from the backend — fully typed.
    Backend(BackendApiError),
}

impl std::fmt::Display for LlmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Precondition(msg) => write!(f, "precondition: {msg}"),
            Self::Backend(e) => write!(f, "backend: {e}"),
        }
    }
}

/// Typed error from the TTS stage.
#[derive(Debug)]
enum TtsError {
    /// Pre-flight failure from `synthesize_reply`.
    Precondition(String),
    /// HTTP/transport error from the backend.
    Backend(BackendApiError),
    /// Base64 decode error on the PCM bytes returned by the backend.
    Decode(String),
}

impl std::fmt::Display for TtsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Precondition(msg) => write!(f, "precondition: {msg}"),
            Self::Backend(e) => write!(f, "backend: {e}"),
            Self::Decode(msg) => write!(f, "decode: {msg}"),
        }
    }
}

/// Build a chat-completions request from rolling meeting history plus
/// the current user prompt, post it through the backend, and return
/// the assistant's reply (trimmed, possibly empty).
async fn llm_meeting(prompt: &str, history: &[ConversationTurn]) -> Result<String, LlmError> {
    use crate::api::config::effective_api_url;
    use crate::api::jwt::get_session_token;
    use crate::api::BackendOAuthClient;
    use reqwest::Method;

    let config = crate::openhuman::config::ops::load_config_with_timeout()
        .await
        .map_err(LlmError::Precondition)?;
    let token = get_session_token(&config)
        .map_err(|e| LlmError::Precondition(e.to_string()))?
        .filter(|t| !t.trim().is_empty())
        .ok_or_else(|| LlmError::Precondition("no backend session token".to_string()))?;

    let api_url = effective_api_url(&config.api_url);
    let client =
        BackendOAuthClient::new(&api_url).map_err(|e| LlmError::Precondition(e.to_string()))?;

    let mut messages: Vec<Value> = Vec::with_capacity(history.len() + 2);
    messages.push(json!({ "role": "system", "content": MEETING_SYSTEM_PROMPT }));
    for turn in history {
        messages.push(json!({ "role": turn.role, "content": turn.content }));
    }
    messages.push(json!({ "role": "user", "content": prompt }));

    let body = json!({
        "model": "agentic-v1",
        "temperature": 0.5,
        "max_tokens": REPLY_MAX_TOKENS,
        "messages": messages,
    });

    let raw = client
        .authed_json_typed(
            &token,
            Method::POST,
            "/openai/v1/chat/completions",
            Some(body),
        )
        .await
        .map_err(LlmError::Backend)?;

    let text = extract_chat_completion_text(&raw).ok_or_else(|| {
        LlmError::Precondition(format!("unexpected chat completions response: {raw}"))
    })?;
    Ok(strip_for_speech(&text))
}

/// Trim characters that sound bad when read aloud by TTS but routinely
/// leak from a chat-completions response (markdown asterisks, fenced
/// code, leading bullets). Keep punctuation that affects prosody
/// (commas, periods, question marks) intact.
fn strip_for_speech(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_code = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") {
            in_code = !in_code;
            continue;
        }
        if in_code {
            continue;
        }
        let cleaned: String = trimmed
            .trim_start_matches(['-', '*', '#', '>'])
            .trim()
            .chars()
            .filter(|c| !matches!(c, '*' | '`' | '_' | '#'))
            .collect();
        if cleaned.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(&cleaned);
    }
    out.trim().to_string()
}

/// One rolling-history entry handed to the LLM.
#[derive(Debug, Clone)]
struct ConversationTurn {
    role: &'static str,
    content: String,
}

/// Pull the last `window` `Heard`/`Spoke` events from the session log
/// and shape them into chat-completions turns. `Note` events are
/// internal book-keeping (errors, wake-word matches) and are skipped.
fn recent_dialog_history(events: &[SessionEvent], window: usize) -> Vec<ConversationTurn> {
    let mut out: Vec<ConversationTurn> = Vec::with_capacity(window);
    for e in events.iter().rev() {
        if out.len() >= window {
            break;
        }
        let role = match e.kind {
            SessionEventKind::Heard => "user",
            SessionEventKind::Spoke => "assistant",
            SessionEventKind::Note => continue,
        };
        let content = e.text.trim();
        if content.is_empty() {
            continue;
        }
        out.push(ConversationTurn {
            role,
            content: content.to_string(),
        });
    }
    out.reverse();
    out
}

async fn tts(text: &str) -> Result<Vec<i16>, TtsError> {
    use crate::openhuman::voice::reply_speech::{
        synthesize_reply, ReplySpeechOptions, SynthesizeError,
    };

    let config = crate::openhuman::config::ops::load_config_with_timeout()
        .await
        .map_err(TtsError::Precondition)?;
    // Tuned for live conversational speech, not narration:
    //   stability 0.4 — leave room for prosody / inflection. Higher
    //     values (>0.6) flatten the read into the "monotone audiobook"
    //     timbre the previous default produced.
    //   similarity_boost 0.75 — keep the chosen voice's character.
    //   style 0.35 — light expressiveness; too high makes punctuation
    //     swallow words.
    //   use_speaker_boost on — louder, clearer in noisy meetings.
    let voice_settings = json!({
        "stability": 0.4,
        "similarity_boost": 0.75,
        "style": 0.35,
        "use_speaker_boost": true,
    });
    let opts = ReplySpeechOptions {
        // Ask ElevenLabs (via the hosted backend) for raw PCM16LE @
        // 16 kHz so we can feed the result straight into the
        // shell-side bridge with no transcoding.
        output_format: Some("pcm_16000".to_string()),
        model_id: Some(TTS_MODEL_ID.to_string()),
        voice_settings: Some(voice_settings),
        ..Default::default()
    };
    let outcome = synthesize_reply(&config, text, &opts)
        .await
        .map_err(|e| match e {
            SynthesizeError::Precondition(msg) => TtsError::Precondition(msg),
            SynthesizeError::Backend(be) => TtsError::Backend(be),
        })?;
    let result = outcome.value;
    let pcm_bytes = B64
        .decode(result.audio_base64.as_bytes())
        .map_err(|e| TtsError::Decode(format!("decode tts base64: {e}")))?;
    if !pcm_bytes.len().is_multiple_of(2) {
        return Err(TtsError::Decode(format!(
            "odd byte length from tts: {}",
            pcm_bytes.len()
        )));
    }
    Ok(pcm_bytes
        .chunks_exact(2)
        .map(|c| i16::from_le_bytes([c[0], c[1]]))
        .collect())
}

fn extract_chat_completion_text(raw: &Value) -> Option<String> {
    raw.get("choices")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|first| first.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|s| s.as_str())
        .map(|s| s.trim().to_string())
}

// ─── Stubs (fallback for tests / no-backend) ────────────────────────

async fn stub_stt(samples: &[i16]) -> String {
    let secs = samples.len() as f32 / SAMPLE_RATE_HZ as f32;
    format!("(heard ~{secs:.1}s of audio)")
}

async fn stub_llm(_heard: &str) -> String {
    "I'm listening.".to_string()
}

async fn stub_tts(text: &str) -> Vec<i16> {
    if text.is_empty() {
        return Vec::new();
    }
    let sample_rate = SAMPLE_RATE_HZ as f32;
    let freq = 440.0_f32;
    let duration_secs = 0.2_f32;
    let count = (sample_rate * duration_secs) as usize;
    (0..count)
        .map(|i| {
            let t = i as f32 / sample_rate;
            (((2.0 * std::f32::consts::PI * freq * t).sin()) * (i16::MAX as f32 * 0.3)) as i16
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::openhuman::meet_agent::session::registry;

    #[tokio::test]
    async fn run_turn_skips_short_buffers() {
        registry().start("brain-skip", 16_000).unwrap();
        registry()
            .with_session("brain-skip", |s| {
                s.push_inbound_pcm(&vec![0; 800]); // 50ms — under floor
            })
            .unwrap();
        assert_eq!(run_turn("brain-skip").await.unwrap(), false);
        let _ = registry().stop("brain-skip");
    }

    #[tokio::test]
    async fn run_turn_falls_back_to_stub_without_backend() {
        // No backend session in test env → STT/LLM/TTS all fail and
        // each stage falls back to its stub. The turn still produces
        // a Heard event, a Spoke event, and synthesized PCM, so the
        // smoke-test contract holds.
        registry().start("brain-fallback", 16_000).unwrap();
        registry()
            .with_session("brain-fallback", |s| {
                s.push_inbound_pcm(&vec![1000; 16_000]); // 1s
            })
            .unwrap();
        assert_eq!(run_turn("brain-fallback").await.unwrap(), true);
        registry()
            .with_session("brain-fallback", |s| {
                let kinds: Vec<_> = s.events().iter().map(|e| format!("{:?}", e.kind)).collect();
                assert!(kinds.contains(&"Heard".to_string()));
                assert!(kinds.contains(&"Spoke".to_string()));
                assert_eq!(s.turn_count, 1);
                assert!(s.spoken_seconds() > 0.0);
            })
            .unwrap();
        let _ = registry().stop("brain-fallback");
    }

    #[test]
    fn extract_chat_completion_text_pulls_first_choice() {
        let raw = json!({
            "choices": [
                { "message": { "content": "  hello world  " } }
            ]
        });
        assert_eq!(
            extract_chat_completion_text(&raw),
            Some("hello world".to_string())
        );
    }

    #[test]
    fn extract_chat_completion_text_returns_none_on_malformed() {
        assert_eq!(extract_chat_completion_text(&json!({})), None);
        assert_eq!(
            extract_chat_completion_text(&json!({ "choices": [] })),
            None
        );
    }

    #[test]
    fn recent_dialog_history_maps_event_kinds_to_chat_roles() {
        let now = 0;
        let events = vec![
            SessionEvent {
                kind: SessionEventKind::Heard,
                text: "Alice: how's the build going".into(),
                timestamp_ms: now,
            },
            SessionEvent {
                kind: SessionEventKind::Note,
                text: "wake word".into(),
                timestamp_ms: now,
            },
            SessionEvent {
                kind: SessionEventKind::Spoke,
                text: "Build is green.".into(),
                timestamp_ms: now,
            },
            SessionEvent {
                kind: SessionEventKind::Heard,
                text: "Bob: ship it".into(),
                timestamp_ms: now,
            },
        ];
        let history = recent_dialog_history(&events, 10);
        assert_eq!(history.len(), 3, "Note events are dropped");
        assert_eq!(history[0].role, "user");
        assert_eq!(history[1].role, "assistant");
        assert_eq!(history[2].role, "user");
        assert_eq!(history[2].content, "Bob: ship it");
    }

    #[test]
    fn recent_dialog_history_caps_at_window_keeping_most_recent() {
        let events: Vec<SessionEvent> = (0..30)
            .map(|i| SessionEvent {
                kind: SessionEventKind::Heard,
                text: format!("line {i}"),
                timestamp_ms: 0,
            })
            .collect();
        let history = recent_dialog_history(&events, 5);
        assert_eq!(history.len(), 5);
        assert_eq!(history[0].content, "line 25");
        assert_eq!(history[4].content, "line 29");
    }

    #[test]
    fn strip_for_speech_removes_markdown_punctuation_and_fences() {
        let raw = "**Got it.** Adding `that` to your follow-ups.";
        assert_eq!(
            strip_for_speech(raw),
            "Got it. Adding that to your follow-ups."
        );
        let fenced = "Sure:\n```\ncode\n```\nDone.";
        assert_eq!(strip_for_speech(fenced), "Sure: Done.");
        let bullets = "- one\n- two";
        assert_eq!(strip_for_speech(bullets), "one two");
    }

    #[test]
    fn strip_for_speech_preserves_empty_when_input_empty() {
        assert_eq!(strip_for_speech(""), "");
        assert_eq!(strip_for_speech("   \n  "), "");
    }

    #[test]
    fn pick_ack_phrase_returns_non_empty_for_real_prompts() {
        // Issue #1372 regression: when the LLM returns nothing after a
        // wake-word fire we fall back to `pick_ack_phrase` and rely on
        // it producing audible text. Empty returns reintroduce silence.
        for prompt in ["remember the launch", "what time is it", "h"] {
            let ack = pick_ack_phrase(prompt);
            assert!(
                !ack.is_empty(),
                "pick_ack_phrase({prompt:?}) returned empty"
            );
        }
    }

    #[tokio::test]
    async fn run_caption_turn_responds_to_wake_only_utterance() {
        // Issue #1372: "hey openhuman" with no follow-up used to drop
        // out via `take_pending_prompt` returning None and the brain
        // returning Ok(false). Now we must produce an audible greeting.
        let request_id = "brain-wake-only";
        registry().start(request_id, 16_000).unwrap();
        registry()
            .with_session(request_id, |s| {
                let fired = s.note_caption("Alice", "hey openhuman", 1);
                assert!(fired, "wake word should fire");
            })
            .unwrap();

        let did_run = run_caption_turn(request_id).await.unwrap();
        assert!(did_run, "wake-only turn must produce a response");

        registry()
            .with_session(request_id, |s| {
                let kinds: Vec<_> = s.events().iter().map(|e| format!("{:?}", e.kind)).collect();
                assert!(
                    kinds.contains(&"Spoke".to_string()),
                    "expected a Spoke event, got events {kinds:?}"
                );
                assert_eq!(s.turn_count, 1);
                assert!(
                    s.spoken_seconds() > 0.0,
                    "expected outbound PCM to be enqueued for the greeting ack"
                );
            })
            .unwrap();
        let _ = registry().stop(request_id);
    }

    #[tokio::test]
    async fn run_caption_turn_responds_with_ack_when_llm_unreachable() {
        // Issue #1372: in test env there's no backend session token,
        // so `llm_meeting` returns Err. The fix is to fall back to a
        // canned ack so the agent never goes silent after a wake fire.
        let request_id = "brain-llm-fail-ack";
        registry().start(request_id, 16_000).unwrap();
        registry()
            .with_session(request_id, |s| {
                let fired = s.note_caption("Alice", "hey openhuman remember the launch", 1);
                assert!(fired);
            })
            .unwrap();

        let did_run = run_caption_turn(request_id).await.unwrap();
        assert!(did_run);

        registry()
            .with_session(request_id, |s| {
                let spoke: Vec<_> = s
                    .events()
                    .iter()
                    .filter(|e| matches!(e.kind, SessionEventKind::Spoke))
                    .map(|e| e.text.clone())
                    .collect();
                assert_eq!(
                    spoke.len(),
                    1,
                    "expected exactly one Spoke event, got {spoke:?}"
                );
                let reply = &spoke[0];
                assert!(!reply.is_empty(), "Spoke reply must not be empty");
                assert!(
                    ACK_PHRASES.iter().any(|a| a == reply),
                    "expected one of {ACK_PHRASES:?}, got {reply:?}"
                );
                assert!(
                    s.spoken_seconds() > 0.0,
                    "expected outbound PCM to be enqueued for the ack"
                );
            })
            .unwrap();
        let _ = registry().stop(request_id);
    }

    #[test]
    fn meeting_system_prompt_does_not_instruct_silence() {
        // Issue #1372 root cause: the prompt told the LLM to return an
        // empty string when in doubt about addressing. Combined with
        // the wake-phrase being stripped before the model saw it, this
        // produced a silent agent. The replacement prompt must not
        // instruct empty-string output.
        let p = MEETING_SYSTEM_PROMPT.to_lowercase();
        assert!(
            !p.contains("output exactly the empty string"),
            "system prompt regressed: still tells model to emit empty string"
        );
        assert!(
            !p.contains("stay silent"),
            "system prompt regressed: still tells model to stay silent"
        );
        // Positive: it must instruct the model to always respond.
        assert!(
            p.contains("always respond") || p.contains("do not return an empty"),
            "system prompt should instruct the model to always respond"
        );
    }

    // ── Billing-blocked behavioural tests ───────────────────────────────────

    /// When `billing_blocked` is pre-set on the session, `run_caption_turn`
    /// must short-circuit immediately and return `Ok(false)` without calling
    /// any LLM or TTS endpoint.
    #[tokio::test]
    async fn billing_blocked_session_short_circuits_caption_turn() {
        let request_id = "brain-billing-blocked-caption";
        registry().start(request_id, 16_000).unwrap();

        // Pre-set billing_blocked. This simulates the state after a prior
        // turn received a 402 BillingConfigMissing response.
        registry()
            .with_session(request_id, |s| {
                // Set the wake state so a normal non-blocked session would
                // proceed — we want to confirm the blocked flag wins.
                let fired = s.note_caption("Alice", "hey openhuman", 1);
                assert!(fired, "wake word should fire even before blocking");
                // Now mark blocked (simulates prior-turn outcome).
                s.billing_blocked = true;
            })
            .unwrap();

        let result = run_caption_turn(request_id).await.unwrap();
        assert!(
            !result,
            "billing-blocked session must return Ok(false), got Ok({result})"
        );

        // Confirm no turn was counted.
        registry()
            .with_session(request_id, |s| {
                assert_eq!(s.turn_count, 0, "no turn should have run when blocked");
            })
            .unwrap();

        let _ = registry().stop(request_id);
    }

    /// When `billing_blocked` is pre-set on the session, `run_turn`
    /// must short-circuit immediately and return `Ok(false)`.
    #[tokio::test]
    async fn billing_blocked_session_short_circuits_run_turn() {
        let request_id = "brain-billing-blocked-run-turn";
        registry().start(request_id, 16_000).unwrap();

        // Push enough samples so the buffer size check passes; then block.
        registry()
            .with_session(request_id, |s| {
                s.push_inbound_pcm(&vec![1000; 16_000]); // 1s
                s.billing_blocked = true;
            })
            .unwrap();

        let result = run_turn(request_id).await.unwrap();
        assert!(
            !result,
            "billing-blocked session must return Ok(false), got Ok({result})"
        );

        // Confirm no turn was counted and PCM was not drained.
        registry()
            .with_session(request_id, |s| {
                assert_eq!(s.turn_count, 0, "no turn should have run when blocked");
            })
            .unwrap();

        let _ = registry().stop(request_id);
    }

    /// State-inspection test: set `billing_blocked = true` and verify that a
    /// subsequent call with a wake prompt short-circuits before touch LLM.
    /// This is the behavioural complement to the error-mapper unit tests
    /// in `src/api/error.rs` — together they pin the full path:
    ///   error mapper → correct variant → brain short-circuits.
    #[tokio::test]
    async fn billing_blocked_persists_across_multiple_caption_turns() {
        let request_id = "brain-billing-persist";
        registry().start(request_id, 16_000).unwrap();

        // Simulate: first turn succeeded, then got blocked.
        registry()
            .with_session(request_id, |s| {
                s.turn_count = 1;
                s.billing_blocked = true;
            })
            .unwrap();

        // Fire a second wake caption — should be rejected.
        registry()
            .with_session(request_id, |s| {
                let _ = s.note_caption("Bob", "hey openhuman what's the time", 100);
                // wake_active is set, but billing_blocked takes precedence.
            })
            .unwrap();

        let result = run_caption_turn(request_id).await.unwrap();
        assert!(!result, "second turn must be blocked");

        registry()
            .with_session(request_id, |s| {
                assert_eq!(s.turn_count, 1, "turn count must not increase when blocked");
            })
            .unwrap();

        let _ = registry().stop(request_id);
    }
}
