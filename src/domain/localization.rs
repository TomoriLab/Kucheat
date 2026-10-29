use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum LanguagePreference {
    #[default]
    #[serde(rename = "system")]
    System,
    #[serde(rename = "ko")]
    Korean,
    #[serde(rename = "en")]
    English,
    #[serde(rename = "ja")]
    Japanese,
    #[serde(rename = "zh-TW")]
    TraditionalChinese,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Locale {
    Korean,
    English,
    Japanese,
    TraditionalChinese,
}

impl LanguagePreference {
    pub fn resolve(self, system: Locale) -> Locale {
        match self {
            Self::System => system,
            Self::Korean => Locale::Korean,
            Self::English => Locale::English,
            Self::Japanese => Locale::Japanese,
            Self::TraditionalChinese => Locale::TraditionalChinese,
        }
    }
}

impl Locale {
    pub const ALL: [Self; 4] = [
        Self::Korean,
        Self::English,
        Self::Japanese,
        Self::TraditionalChinese,
    ];

    pub fn from_tag(tag: &str) -> Option<Self> {
        match tag
            .trim()
            .split(['-', '_', '.', '@'])
            .next()?
            .to_ascii_lowercase()
            .as_str()
        {
            "ko" => Some(Self::Korean),
            "en" => Some(Self::English),
            "ja" => Some(Self::Japanese),
            "zh" => Some(Self::TraditionalChinese),
            _ => None,
        }
    }

    pub fn tag(self) -> &'static str {
        match self {
            Self::Korean => "ko",
            Self::English => "en",
            Self::Japanese => "ja",
            Self::TraditionalChinese => "zh-TW",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_tags_accept_regions_encodings_and_chinese_variants() {
        for (tag, locale) in [
            ("ko_KR.UTF-8", Locale::Korean),
            (" EN-us ", Locale::English),
            ("ja_JP@calendar", Locale::Japanese),
            ("zh-TW", Locale::TraditionalChinese),
            ("zh-Hant-HK", Locale::TraditionalChinese),
            ("zh_CN.UTF-8", Locale::TraditionalChinese),
        ] {
            assert_eq!(Locale::from_tag(tag), Some(locale));
        }
        assert_eq!(Locale::from_tag("fr-FR"), None);
        assert_eq!(Locale::from_tag("C.UTF-8"), None);
    }

    #[test]
    fn language_preferences_use_stable_serialized_tags_and_reject_unknown_values() {
        for (tag, expected) in [
            ("system", LanguagePreference::System),
            ("ko", LanguagePreference::Korean),
            ("en", LanguagePreference::English),
            ("ja", LanguagePreference::Japanese),
            ("zh-TW", LanguagePreference::TraditionalChinese),
        ] {
            let serialized = serde_json::to_value(expected).unwrap();
            assert_eq!(serialized, tag);
            assert_eq!(
                serde_json::from_value::<LanguagePreference>(serialized).unwrap(),
                expected
            );
        }
        assert!(serde_json::from_value::<LanguagePreference>(serde_json::json!("zh-CN")).is_err());
        assert_eq!(
            LanguagePreference::Japanese.resolve(Locale::Korean),
            Locale::Japanese
        );
        assert_eq!(
            LanguagePreference::System.resolve(Locale::English),
            Locale::English
        );
    }
}
