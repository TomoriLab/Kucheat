mod catalog;
mod en;
mod ja;
mod ko;
mod zh_tw;

use std::sync::Arc;

use crate::application::ports::ConfigurationRepository;
use crate::domain::localization::Locale;

pub use catalog::{Catalog, format_count, interpolate};

pub struct NativeLocalizer {
    configuration: Arc<dyn ConfigurationRepository>,
    system_locale: Locale,
}

impl NativeLocalizer {
    pub fn new(configuration: Arc<dyn ConfigurationRepository>, system_locale: Locale) -> Self {
        Self {
            configuration,
            system_locale,
        }
    }

    pub fn locale(&self) -> Locale {
        self.configuration
            .load_existing()
            .ok()
            .flatten()
            .map(|config| config.settings.language)
            .unwrap_or_default()
            .resolve(self.system_locale)
    }

    pub fn catalog(&self) -> &'static Catalog {
        catalog_for(self.locale())
    }
}

pub fn catalog_for(locale: Locale) -> &'static Catalog {
    match locale {
        Locale::Korean => &ko::MESSAGES,
        Locale::English => &en::MESSAGES,
        Locale::Japanese => &ja::MESSAGES,
        Locale::TraditionalChinese => &zh_tw::MESSAGES,
    }
}

pub fn detect_system_locale() -> Locale {
    let preference = ["LC_ALL", "LC_MESSAGES", "LANGUAGE", "LANG"]
        .iter()
        .filter_map(|name| std::env::var(name).ok())
        .find(|value| !value.trim().is_empty());
    preference
        .and_then(|value| value.split(':').find_map(Locale::from_tag))
        .unwrap_or(Locale::English)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    fn placeholders(template: &str) -> BTreeSet<&str> {
        template
            .split('{')
            .skip(1)
            .filter_map(|part| part.split_once('}').map(|(name, _)| name))
            .collect()
    }

    #[test]
    fn all_catalogs_are_complete_and_preserve_interpolation_variables() {
        let reference: Vec<_> = catalog_for(Locale::English).entries().collect();
        for locale in Locale::ALL {
            let entries: Vec<_> = catalog_for(locale).entries().collect();
            assert_eq!(entries.len(), reference.len());
            for ((key, translated), (reference_key, original)) in entries.iter().zip(&reference) {
                assert_eq!(key, reference_key);
                assert!(!translated.trim().is_empty(), "{}: {key}", locale.tag());
                assert_eq!(
                    placeholders(translated),
                    placeholders(original),
                    "{}: {key}",
                    locale.tag()
                );
            }
        }
    }

    #[test]
    fn interpolation_does_not_interpret_user_content_as_more_placeholders() {
        assert_eq!(
            interpolate(
                "{name}: {count}",
                &[("name", "Streamer {count}"), ("count", "42")]
            ),
            "Streamer {count}: 42"
        );
        assert_eq!(interpolate("{unknown}", &[]), "{unknown}");
        assert_eq!(format_count(1234567), "1,234,567");
        assert_eq!(format_count(-1234), "-1,234");
        assert_eq!(format_count(0), "0");
    }
}
