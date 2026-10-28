use anyhow::{Result, bail};

fn normalize_channel_id(input: &str) -> Result<String> {
    let input = input.trim();
    if input.len() > 1024 {
        bail!("Channel input exceeds 1024 bytes");
    }
    let identifier = if input.starts_with("https://") {
        let url = reqwest::Url::parse(input)?;
        if url.host_str() != Some("chzzk.naver.com")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port().is_some()
        {
            bail!("Only HTTPS channel URLs on chzzk.naver.com are supported");
        }
        let segments: Vec<_> = url.path().trim_matches('/').split('/').collect();
        match segments.as_slice() {
            [identifier] | ["live", identifier] => (*identifier).to_owned(),
            _ => bail!("Use a CHZZK channel URL or live stream URL"),
        }
    } else {
        input.to_owned()
    };
    if identifier.len() != 32 || !identifier.bytes().all(|value| value.is_ascii_hexdigit()) {
        bail!("Channel IDs must contain exactly 32 hexadecimal characters");
    }
    Ok(identifier.to_ascii_lowercase())
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ChannelId(String);

impl ChannelId {
    pub fn parse(input: &str) -> Result<Self> {
        normalize_channel_id(input).map(Self)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn into_string(self) -> String {
        self.0
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelInfo {
    pub channel_id: String,
    pub channel_name: String,
    pub channel_image_url: Option<String>,
    #[serde(default)]
    pub open_live: bool,
}

#[derive(Debug, Clone)]
pub struct LiveStatus {
    pub is_live: bool,
    pub channel_name: String,
    pub channel_image_url: Option<String>,
    pub live_title: Option<String>,
    pub category: Option<String>,
    pub viewer_count: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    const IDENTIFIER: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn accepts_ids_and_official_channel_urls() {
        for input in [
            IDENTIFIER.to_uppercase(),
            format!(" {IDENTIFIER} "),
            format!("https://chzzk.naver.com/{IDENTIFIER}"),
            format!("https://chzzk.naver.com/live/{IDENTIFIER}?source=test"),
        ] {
            assert_eq!(normalize_channel_id(&input).unwrap(), IDENTIFIER);
        }
    }

    #[test]
    fn rejects_foreign_urls_and_non_channel_paths() {
        for input in [
            String::new(),
            "invalid".to_owned(),
            format!("http://chzzk.naver.com/{IDENTIFIER}"),
            format!("https://chzzk.naver.com.evil.example/{IDENTIFIER}"),
            format!("https://user@chzzk.naver.com/{IDENTIFIER}"),
            format!("https://chzzk.naver.com:444/{IDENTIFIER}"),
            format!("https://chzzk.naver.com/video/{IDENTIFIER}"),
            format!("{IDENTIFIER}/../../file"),
        ] {
            assert!(normalize_channel_id(&input).is_err(), "{input}");
        }
    }
}
