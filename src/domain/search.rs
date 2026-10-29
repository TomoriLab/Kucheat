pub const SEARCH_PAGE_SIZE: u32 = 20;
pub const MAXIMUM_SEARCH_OFFSET: u32 = 1000;
pub const MAXIMUM_SEARCH_QUERY_CHARACTERS: usize = 100;

#[derive(Debug, Clone)]
pub struct ChannelSearchEntry {
    pub id: String,
    pub name: String,
    pub channel_image_url: Option<String>,
    pub is_live: bool,
    pub follower_count: Option<i64>,
}

#[derive(Debug, Clone, Default)]
pub struct ChannelSearchPage {
    pub channels: Vec<ChannelSearchEntry>,
    pub next_offset: Option<u32>,
}
