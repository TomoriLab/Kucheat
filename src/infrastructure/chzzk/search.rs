use anyhow::Result;
use reqwest::Url;
use serde::Deserialize;

use crate::domain::channel::ChannelInfo;
use crate::domain::search::{ChannelSearchEntry, ChannelSearchPage, SEARCH_PAGE_SIZE};

#[derive(Deserialize)]
pub(super) struct SearchResponse {
    data: Vec<SearchItem>,
    page: Option<SearchPagination>,
}

#[derive(Deserialize)]
struct SearchItem {
    channel: SearchChannel,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchChannel {
    #[serde(flatten)]
    information: ChannelInfo,
    follower_count: Option<i64>,
}

#[derive(Deserialize)]
struct SearchPagination {
    next: Option<SearchCursor>,
}

#[derive(Deserialize)]
struct SearchCursor {
    offset: u32,
}

impl SearchResponse {
    pub(super) fn into_page(self) -> ChannelSearchPage {
        ChannelSearchPage {
            channels: self
                .data
                .into_iter()
                .map(|item| ChannelSearchEntry {
                    id: item.channel.information.channel_id,
                    name: item.channel.information.channel_name,
                    channel_image_url: item.channel.information.channel_image_url,
                    is_live: item.channel.information.open_live,
                    follower_count: item.channel.follower_count,
                })
                .collect(),
            next_offset: self
                .page
                .and_then(|page| page.next)
                .map(|cursor| cursor.offset),
        }
    }
}

pub(super) fn search_url(base: &str, query: &str, offset: u32) -> Result<Url> {
    let mut url = Url::parse(base)?.join("/service/v1/search/channels")?;
    url.query_pairs_mut()
        .append_pair("keyword", query)
        .append_pair("offset", &offset.to_string())
        .append_pair("size", &SEARCH_PAGE_SIZE.to_string())
        .append_pair("withFirstChannelContent", "false");
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_urls_encode_unicode_and_query_delimiters_without_changing_the_endpoint() {
        let query = "침착맨 日本語 &offset=999?size=100#fragment";
        let url = search_url("https://api.chzzk.naver.com", query, 20).unwrap();
        assert_eq!(url.host_str(), Some("api.chzzk.naver.com"));
        assert_eq!(url.path(), "/service/v1/search/channels");
        assert!(url.fragment().is_none());
        let parameters: std::collections::HashMap<_, _> = url.query_pairs().collect();
        assert_eq!(parameters.len(), 4);
        assert_eq!(parameters["keyword"], query);
        assert_eq!(parameters["offset"], "20");
        assert_eq!(parameters["size"], "20");
        assert_eq!(parameters["withFirstChannelContent"], "false");
    }

    #[test]
    fn parses_nested_search_channels_and_the_actual_next_page_cursor() {
        let response: SearchResponse = serde_json::from_value(serde_json::json!({
            "size": 20,
            "page": { "next": { "offset": 20 }, "prev": null },
            "data": [{ "channel": {
                "channelId": "0123456789abcdef0123456789abcdef",
                "channelName": "Streamer 日本語",
                "channelImageUrl": "https://nng-phinf.pstatic.net/profile.png",
                "openLive": true,
                "followerCount": 1234
            }}]
        }))
        .unwrap();
        let page = response.into_page();
        assert_eq!(page.next_offset, Some(20));
        assert_eq!(page.channels.len(), 1);
        assert_eq!(page.channels[0].name, "Streamer 日本語");
        assert_eq!(page.channels[0].follower_count, Some(1234));
        assert!(page.channels[0].is_live);
    }

    #[test]
    fn empty_or_last_search_pages_have_no_next_cursor() {
        for serialized in [
            serde_json::json!({ "data": [], "page": { "next": null }}),
            serde_json::json!({ "data": [] }),
        ] {
            let response: SearchResponse = serde_json::from_value(serialized).unwrap();
            let page = response.into_page();
            assert!(page.channels.is_empty());
            assert!(page.next_offset.is_none());
        }
    }

    #[test]
    fn missing_profiles_and_follower_counts_remain_optional() {
        let response: SearchResponse = serde_json::from_value(serde_json::json!({
            "data": [{ "channel": { "channelId": "id", "channelName": "Name", "openLive": false }}]
        }))
        .unwrap();
        let page = response.into_page();
        assert!(page.channels[0].channel_image_url.is_none());
        assert!(page.channels[0].follower_count.is_none());
        assert!(!page.channels[0].is_live);
    }
}
