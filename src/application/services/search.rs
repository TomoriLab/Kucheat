use std::collections::HashSet;
use std::sync::Arc;

use anyhow::{Result, ensure};

use crate::application::dto::{ChannelSearchResults, ChannelSearchView};
use crate::application::ports::{ChannelGatewayFactory, ConfigurationRepository};
use crate::domain::channel::ChannelId;
use crate::domain::search::{
    MAXIMUM_SEARCH_OFFSET, MAXIMUM_SEARCH_QUERY_CHARACTERS, SEARCH_PAGE_SIZE,
};

pub struct ChannelSearchService {
    configuration: Arc<dyn ConfigurationRepository>,
    gateways: Arc<dyn ChannelGatewayFactory>,
}

impl ChannelSearchService {
    pub fn new(
        configuration: Arc<dyn ConfigurationRepository>,
        gateways: Arc<dyn ChannelGatewayFactory>,
    ) -> Self {
        Self {
            configuration,
            gateways,
        }
    }

    pub async fn search(&self, query: &str, offset: u32) -> Result<ChannelSearchResults> {
        let query = query.trim();
        ensure!(!query.is_empty(), "Search query must not be empty");
        ensure!(
            query.chars().count() <= MAXIMUM_SEARCH_QUERY_CHARACTERS,
            "Search query exceeds 100 characters"
        );
        ensure!(
            offset <= MAXIMUM_SEARCH_OFFSET,
            "Search offset exceeds 1000"
        );
        let config = self.configuration.load_existing()?.unwrap_or_default();
        let gateway = self.gateways.create(&config.api)?;
        let page = gateway.search_channels(query, offset).await?;
        // Registration can change while the external search is in progress.
        let current = self.configuration.load_existing()?.unwrap_or_default();
        let mut identifiers = HashSet::new();
        let channels = page
            .channels
            .into_iter()
            .take(SEARCH_PAGE_SIZE as usize)
            .filter_map(|entry| {
                let id = ChannelId::parse(&entry.id).ok()?.into_string();
                if !identifiers.insert(id.clone()) {
                    return None;
                }
                let registered = current
                    .channels
                    .iter()
                    .any(|channel| channel.id.eq_ignore_ascii_case(&id));
                Some(ChannelSearchView {
                    name: if entry.name.trim().is_empty() {
                        id.clone()
                    } else {
                        entry.name
                    },
                    id,
                    channel_image_url: entry.channel_image_url,
                    is_live: entry.is_live,
                    follower_count: entry.follower_count.filter(|count| *count >= 0),
                    registered,
                })
            })
            .collect();
        Ok(ChannelSearchResults {
            channels,
            next_offset: page
                .next_offset
                .filter(|next| *next > offset && *next <= MAXIMUM_SEARCH_OFFSET),
        })
    }
}
