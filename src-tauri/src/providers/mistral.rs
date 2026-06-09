//! Mistral chat API — OpenAI-compatible, so it reuses the OpenAI streaming path.

use std::sync::atomic::AtomicBool;

use tauri::ipc::Channel;

use super::{openai, ChatResponse, CompletionRequest, Provider, StreamDelta};

const BASE_URL: &str = "https://api.mistral.ai/v1";

pub struct Mistral;

impl Provider for Mistral {
    async fn stream(
        &self,
        client: &reqwest::Client,
        req: &CompletionRequest<'_>,
        channel: &Channel<StreamDelta>,
        cancel: &AtomicBool,
    ) -> anyhow::Result<ChatResponse> {
        openai::chat_completions_stream(
            client,
            BASE_URL,
            req.api_key,
            req.model,
            req.messages,
            channel,
            cancel,
        )
        .await
    }
}
