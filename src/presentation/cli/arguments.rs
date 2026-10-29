use clap::{Command, CommandFactory, FromArgMatches, Parser, Subcommand};

use crate::infrastructure::localization::Catalog;

#[derive(Parser)]
#[command(name = "kucheat", version)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Commands>,
}

#[derive(Debug, Subcommand)]
pub enum AutoLaunchCommand {
    Install,
    Uninstall,
}

#[derive(Debug, Subcommand)]
pub enum Commands {
    Gui,
    Daemon,
    Tray,
    Add {
        channel_id: String,
        #[arg(short, long)]
        name: Option<String>,
    },
    Remove {
        channel_id: String,
    },
    List,
    Status,
    AutoLaunch {
        #[command(subcommand)]
        command: AutoLaunchCommand,
    },
}

impl Cli {
    pub fn parse_localized(messages: &'static Catalog) -> Self {
        let matches = localize_command(Self::command(), messages).get_matches();
        Self::from_arg_matches(&matches).unwrap_or_else(|error| error.exit())
    }
}

fn localize_command(mut command: Command, messages: &'static Catalog) -> Command {
    let description = match command.get_name() {
        "kucheat" => messages.app_description,
        "gui" => messages.command_gui,
        "daemon" => messages.command_daemon,
        "tray" => messages.command_tray,
        "add" => messages.command_add,
        "remove" => messages.command_remove,
        "list" => messages.command_list,
        "status" => messages.command_status,
        "auto-launch" => messages.command_auto_launch,
        "install" => messages.command_install,
        "uninstall" => messages.command_uninstall,
        _ => messages.command_help,
    };
    command = command
        .about(description)
        .help_template(messages.help_template)
        .subcommand_help_heading(messages.commands_heading);
    command.build();
    let arguments: Vec<_> = command
        .get_arguments()
        .map(|argument| argument.get_id().clone())
        .collect();
    for identifier in arguments {
        let help = match identifier.as_str() {
            "help" => messages.help_option,
            "version" => messages.version_option,
            "channel_id" => messages.argument_channel,
            "name" => messages.argument_name,
            _ => continue,
        };
        command = command.mut_arg(identifier, |argument| {
            argument.help(help).help_heading(messages.options_heading)
        });
    }
    let children: Vec<_> = command
        .get_subcommands()
        .map(|child| child.get_name().to_owned())
        .collect();
    for name in children {
        // The generated help command mirrors the command tree and does not need recursive expansion.
        command = command.mut_subcommand(name, |child| {
            if child.get_name() == "help" {
                child.about(messages.command_help)
            } else {
                localize_command(child, messages)
            }
        });
    }
    command
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::localization::Locale;
    use crate::infrastructure::localization::catalog_for;

    #[test]
    fn command_help_uses_each_catalog_without_changing_command_names() {
        for locale in Locale::ALL {
            let messages = catalog_for(locale);
            let mut command = localize_command(Cli::command(), messages);
            let help = command.render_help().to_string();
            assert!(help.contains(messages.app_description));
            assert!(help.contains(messages.command_gui));
            assert!(help.contains(messages.commands_heading));
            let mut add = command.find_subcommand("add").unwrap().clone();
            assert!(
                add.render_help()
                    .to_string()
                    .contains(messages.argument_channel)
            );
            let matches = command
                .try_get_matches_from(["kucheat", "auto-launch", "install"])
                .unwrap();
            assert!(matches!(
                Cli::from_arg_matches(&matches).unwrap().command,
                Some(Commands::AutoLaunch {
                    command: AutoLaunchCommand::Install
                })
            ));
        }
    }
}
