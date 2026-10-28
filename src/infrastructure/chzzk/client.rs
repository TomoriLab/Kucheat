use anyhow::{Context, Result, bail};
use reqwest::Client;
use serde::Deserialize;
use serde::de::DeserializeOwned;

use crate::application::ports::{ChannelGateway, ChannelGatewayFactory, PortFuture};
use crate::domain::channel::{ChannelInfo, LiveStatus};
use crate::domain::config::ApiConfig;

const OFFICIAL_BASE_URL: &str = "https://openapi.chzzk.naver.com";
const UNOFFICIAL_BASE_URL: &str = "https://api.chzzk.naver.com";

const USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 \
                          (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// API response wrappers
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiResponse<T> {
    code: i32,
    message: Option<String>,
    content: Option<T>,
}

/// Official API wraps channel list in `{ data: [...] }`.
#[derive(Debug, Deserialize)]
struct PagedData<T> {
    data: Vec<T>,
}

// ---------------------------------------------------------------------------
// Official API channel info (GET /open/v1/channels?channelIds=…)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfficialChannelInfo {
    channel_id: String,
    channel_name: String,
    channel_image_url: Option<String>,
}

// ---------------------------------------------------------------------------
// Live detail (unofficial API)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveDetail {
    pub live_title: Option<String>,
    #[serde(default)]
    pub concurrent_user_count: i64,
    pub live_category: Option<String>,
    pub live_category_value: Option<String>,
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

pub struct ChzzkClient {
    client: Client,
    use_official: bool,
    client_id: String,
    client_secret: String,
}

impl ChzzkClient {
    pub fn new(config: &ApiConfig) -> Result<Self> {
        let use_official = !config.client_id.is_empty() && !config.client_secret.is_empty();

        if use_official {
            tracing::info!("Official CHZZK credentials configured");
        } else {
            tracing::info!("No client credentials — using unofficial API only");
        }

        let client = Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(std::time::Duration::from_secs(5))
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .context("Failed to create HTTP client")?;

        Ok(Self {
            client,
            use_official,
            client_id: config.client_id.clone(),
            client_secret: config.client_secret.clone(),
        })
    }

    // -----------------------------------------------------------------------
    // Generic fetch helper — eliminates repeated HTTP+parse+error boilerplate
    // -----------------------------------------------------------------------

    async fn fetch_json<T: DeserializeOwned>(&self, url: &str, auth: bool) -> Result<T> {
        tracing::debug!(url = url, auth = auth, "API request");

        let mut req = self.client.get(url);
        if auth {
            req = req
                .header("Client-Id", &self.client_id)
                .header("Client-Secret", &self.client_secret);
        }

        let body = req
            .send()
            .await
            .context("HTTP request failed")?
            .text()
            .await
            .context("Failed to read response body")?;

        tracing::debug!(body_len = body.len(), "API response received");

        let api: ApiResponse<T> = serde_json::from_str(&body).with_context(|| {
            format!(
                "Failed to parse API response. Body: {}",
                body.chars().take(500).collect::<String>()
            )
        })?;

        tracing::debug!(code = api.code, message = ?api.message, "API response parsed");

        if api.code != 200 {
            bail!(
                "API error ({}): {}",
                api.code,
                api.message.unwrap_or_default()
            );
        }

        api.content.context("Empty content in API response")
    }

    // -----------------------------------------------------------------------
    // Channel info
    // -----------------------------------------------------------------------

    /// Get basic channel info. Tries official API first (if configured),
    /// then falls back to unofficial.
    pub async fn get_channel_info(&self, channel_id: &str) -> Result<ChannelInfo> {
        tracing::debug!(
            channel_id = channel_id,
            use_official = self.use_official,
            "Fetching channel info"
        );
        if self.use_official {
            match self.get_channel_info_official(channel_id).await {
                Ok(info) => {
                    tracing::debug!(channel_name = %info.channel_name, "Got channel info (official)");
                    return Ok(info);
                }
                Err(e) => {
                    tracing::warn!("Official channel info failed, falling back: {e}");
                }
            }
        }
        let info = self.get_channel_info_unofficial(channel_id).await?;
        tracing::debug!(channel_name = %info.channel_name, open_live = info.open_live, "Got channel info (unofficial)");
        Ok(info)
    }

    /// Official: `GET /open/v1/channels?channelIds=<id>`
    async fn get_channel_info_official(&self, channel_id: &str) -> Result<ChannelInfo> {
        let url = format!("{OFFICIAL_BASE_URL}/open/v1/channels?channelIds={channel_id}");

        let paged: PagedData<OfficialChannelInfo> = self.fetch_json(&url, true).await?;

        let ch = paged
            .data
            .into_iter()
            .next()
            .context("No channel found in official API response")?;

        Ok(ChannelInfo {
            channel_id: ch.channel_id,
            channel_name: ch.channel_name,
            channel_image_url: ch.channel_image_url,
            open_live: false, // official API does not provide this
        })
    }

    /// Unofficial: `GET /service/v1/channels/<id>`
    async fn get_channel_info_unofficial(&self, channel_id: &str) -> Result<ChannelInfo> {
        let url = format!("{UNOFFICIAL_BASE_URL}/service/v1/channels/{channel_id}");
        self.fetch_json(&url, false).await
    }

    // -----------------------------------------------------------------------
    // Live detail (always unofficial)
    // -----------------------------------------------------------------------

    async fn get_live_detail(&self, channel_id: &str) -> Result<LiveDetail> {
        let url = format!("{UNOFFICIAL_BASE_URL}/service/v3/channels/{channel_id}/live-detail");
        self.fetch_json(&url, false).await
    }

    // -----------------------------------------------------------------------
    // High-level live check
    // -----------------------------------------------------------------------

    /// Check whether a channel is currently live and gather details.
    /// Always uses the **unofficial** API because only it has `openLive`.
    pub async fn check_channel_live(&self, channel_id: &str) -> Result<LiveStatus> {
        tracing::debug!(channel_id = channel_id, "Checking live status");
        let ch = self.get_channel_info_unofficial(channel_id).await?;

        let mut status = LiveStatus {
            is_live: ch.open_live,
            channel_name: ch.channel_name,
            channel_image_url: ch.channel_image_url,
            live_title: None,
            category: None,
            viewer_count: None,
        };

        if ch.open_live {
            tracing::debug!(channel_id = channel_id, "Channel is live, fetching detail");
            match self.get_live_detail(channel_id).await {
                Ok(detail) => {
                    tracing::debug!(
                        channel_id = channel_id,
                        title = ?detail.live_title,
                        viewers = detail.concurrent_user_count,
                        category = ?detail.live_category_value,
                        "Live detail fetched"
                    );
                    status.live_title = detail.live_title;
                    status.category = detail.live_category_value.or(detail.live_category);
                    status.viewer_count = Some(detail.concurrent_user_count);
                }
                Err(e) => {
                    tracing::warn!("Failed to get live detail for {channel_id}: {e}");
                }
            }
        } else {
            tracing::debug!(channel_id = channel_id, "Channel is offline");
        }

        Ok(status)
    }
}

impl ChannelGateway for ChzzkClient {
    fn channel_info<'a>(&'a self, identifier: &'a str) -> PortFuture<'a, ChannelInfo> {
        Box::pin(self.get_channel_info(identifier))
    }

    fn live_status<'a>(&'a self, identifier: &'a str) -> PortFuture<'a, LiveStatus> {
        Box::pin(self.check_channel_live(identifier))
    }
}

pub struct ChzzkGatewayFactory;

impl ChannelGatewayFactory for ChzzkGatewayFactory {
    fn create(&self, config: &ApiConfig) -> Result<std::sync::Arc<dyn ChannelGateway>> {
        Ok(std::sync::Arc::new(ChzzkClient::new(config)?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn unicode_error_responses_do_not_panic() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let body = "오류".repeat(300);
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = [0; 4096];
            let count = socket.read(&mut buffer).await.unwrap();
            assert!(count > 0);
            socket.write_all(response.as_bytes()).await.unwrap();
        });
        let config = crate::domain::config::Config::default();
        let client = ChzzkClient::new(&config.api).unwrap();
        let result = client
            .fetch_json::<ChannelInfo>(&format!("http://{address}"), false)
            .await;
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Failed to parse API response")
        );
        server.await.unwrap();
    }
}
