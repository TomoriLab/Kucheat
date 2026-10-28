BINARY      := target/release/kucheat
INSTALL_BIN := $(HOME)/.local/bin/kucheat
SERVICE_DIR := $(HOME)/.config/systemd/user
ICON_DIR    := $(HOME)/.local/share/icons/hicolor/512x512/apps
APPLICATION_DIR := $(HOME)/.local/share/applications

.PHONY: build install uninstall clean

build:
	cargo build --release

install: build
	@echo "📦 Installing binary..."
	install -Dm755 $(BINARY) $(INSTALL_BIN)
	@echo "📋 Installing systemd user service..."
	install -Dm644 systemd/kucheat.service $(SERVICE_DIR)/kucheat.service
	systemctl --user daemon-reload
	@echo "🎨 Installing notification icon..."
	install -Dm644 assets/icons/kucheat.png $(ICON_DIR)/kucheat.png
	@echo "Installing desktop launcher..."
	install -d "$(APPLICATION_DIR)"
	sed 's|^Exec=kucheat$$|Exec="$(INSTALL_BIN)"|' assets/kucheat.desktop > "$(APPLICATION_DIR)/kucheat.desktop"
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

uninstall:
	@echo "🗑️  Uninstalling kucheat..."
	systemctl --user stop kucheat 2>/dev/null || true
	systemctl --user disable kucheat 2>/dev/null || true
	rm -f $(INSTALL_BIN)
	rm -f $(SERVICE_DIR)/kucheat.service
	systemctl --user daemon-reload
	rm -f $(ICON_DIR)/kucheat.png
	rm -f "$(APPLICATION_DIR)/kucheat.desktop"
	@echo "✅ Uninstalled."

clean:
	cargo clean
