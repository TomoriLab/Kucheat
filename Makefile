BINARY      := target/release/kucheat
INSTALL_BIN := $(HOME)/.local/bin/kucheat
SERVICE_DIR := $(HOME)/.config/systemd/user
DATA_HOME   := $(if $(XDG_DATA_HOME),$(XDG_DATA_HOME),$(HOME)/.local/share)
ICON_THEME_DIR := $(DATA_HOME)/icons/hicolor
ICON_DIR    := $(ICON_THEME_DIR)/512x512/apps
APPLICATION_DIR := $(DATA_HOME)/applications

.PHONY: build install check-desktop-executable install-desktop refresh-desktop-cache uninstall uninstall-desktop clean

build:
	cargo build --release

install: build
	@echo "📦 Installing binary..."
	install -Dm755 $(BINARY) $(INSTALL_BIN)
	@echo "📋 Installing systemd user service..."
	install -Dm644 systemd/kucheat.service $(SERVICE_DIR)/kucheat.service
	systemctl --user daemon-reload
	$(MAKE) install-desktop
	@echo ""
	@echo "✅ Installation complete!"
	@echo ""
	@echo "Usage:"
	@echo "  kucheat                              Open the desktop app"
	@echo "  kucheat add <CHANNEL_ID>             Add a channel"
	@echo "  kucheat list                         List channels"
	@echo "  kucheat status                       Check live status"
	@echo ""
	@echo "Daemon:"
	@echo "  systemctl --user enable kucheat      Auto-start on login"
	@echo "  systemctl --user start kucheat       Start daemon"
	@echo "  systemctl --user status kucheat      Check daemon status"
	@echo "  journalctl --user -u kucheat -f      Stream logs"
	@echo ""
	@echo "Tray:"
	@echo "  kucheat tray                         Manual start"

check-desktop-executable:
	@test -x "$(INSTALL_BIN)" || { echo "Executable not found or not executable: $(INSTALL_BIN). Run make install or set INSTALL_BIN to a GUI-enabled build." >&2; exit 1; }
	@help_output=$$("$(INSTALL_BIN)" --help) && printf '%s\n' "$$help_output" | grep -Eq '^[[:space:]]+gui([[:space:]]|$$)' || { echo "A GUI-enabled Kucheat executable is required: $(INSTALL_BIN). Run make install to update an older or headless installation." >&2; exit 1; }

install-desktop: check-desktop-executable
	@echo "Installing desktop icon and launcher..."
	install -Dm644 assets/icons/kucheat.png "$(ICON_DIR)/kucheat.png"
	install -d "$(APPLICATION_DIR)"
	sed 's|^Exec=kucheat$$|Exec="$(INSTALL_BIN)"|' assets/kucheat.desktop > "$(APPLICATION_DIR)/kucheat.desktop"
	chmod 644 "$(APPLICATION_DIR)/kucheat.desktop"
	$(MAKE) refresh-desktop-cache

refresh-desktop-cache:
	@if command -v update-desktop-database >/dev/null 2>&1; then \
		update-desktop-database "$(APPLICATION_DIR)" || echo "Desktop database refresh failed; a session restart may be required." >&2; \
	fi
	@if command -v gtk-update-icon-cache >/dev/null 2>&1 && [ -d "$(ICON_THEME_DIR)" ]; then \
		gtk-update-icon-cache --force --ignore-theme-index "$(ICON_THEME_DIR)" || echo "Icon cache refresh failed; a session restart may be required." >&2; \
	fi
	@case ":$${XDG_CURRENT_DESKTOP}:" in *:KDE:*) \
		if command -v kbuildsycoca6 >/dev/null 2>&1; then \
			kbuildsycoca6 --noincremental || echo "KDE application cache refresh failed; a session restart may be required." >&2; \
		fi ;; \
	esac

uninstall-desktop:
	rm -f "$(ICON_DIR)/kucheat.png" "$(APPLICATION_DIR)/kucheat.desktop"
	$(MAKE) refresh-desktop-cache

uninstall:
	@echo "🗑️  Uninstalling kucheat..."
	systemctl --user stop kucheat 2>/dev/null || true
	systemctl --user disable kucheat 2>/dev/null || true
	rm -f $(INSTALL_BIN)
	rm -f $(SERVICE_DIR)/kucheat.service
	systemctl --user daemon-reload
	$(MAKE) uninstall-desktop
	@echo "✅ Uninstalled."

clean:
	cargo clean
