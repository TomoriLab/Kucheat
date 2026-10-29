macro_rules! define_catalog {
    ($($key:ident),+ $(,)?) => {
        pub struct Catalog { $(pub $key: &'static str,)+ }

        impl Catalog {
            #[cfg(test)]
            pub(super) fn entries(&self) -> impl Iterator<Item = (&'static str, &'static str)> {
                [$( (stringify!($key), self.$key), )+].into_iter()
            }
        }
    };
}

define_catalog! {
    app_description, command_gui, command_daemon, command_tray, command_add,
    command_remove, command_list, command_status, command_auto_launch,
    command_install, command_uninstall, command_help, argument_channel, argument_name,
    help_option, version_option, commands_heading, options_heading, help_template,
    notification_live, notification_offline, notification_category, notification_viewers,
    watch_live, open_channel, notification_test_title, notification_test_body,
    tray_title, tray_live_count, tray_no_live, tray_no_channels, tray_live_section,
    tray_offline_section, quit, cli_add_error, cli_error_detail, cli_added, cli_removed,
    cli_not_found, cli_empty, cli_list_heading, cli_status_heading,
    status_live, status_offline, status_unknown, autostart_enabled, autostart_disabled,
    gui_disabled,
}

pub fn interpolate(template: &str, arguments: &[(&str, &str)]) -> String {
    let mut output = String::new();
    let mut remaining = template;
    while let Some((prefix, suffix)) = remaining.split_once('{') {
        output.push_str(prefix);
        let Some((key, tail)) = suffix.split_once('}') else {
            output.push('{');
            output.push_str(suffix);
            return output;
        };
        if let Some((_, value)) = arguments.iter().find(|(name, _)| *name == key) {
            output.push_str(value);
        } else {
            output.push('{');
            output.push_str(key);
            output.push('}');
        }
        remaining = tail;
    }
    output.push_str(remaining);
    output
}

pub fn format_count(value: i64) -> String {
    // All supported locales use three-digit grouping with commas for these integer counts.
    let digits = value.unsigned_abs().to_string();
    let mut output = if value < 0 {
        "-".to_owned()
    } else {
        String::new()
    };
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            output.push(',');
        }
        output.push(digit);
    }
    output
}
