import type { Channel } from "../../domain/types.ts";
import type { Operation } from "../../application/state/dashboard-state.ts";
import { element, isDisabled, setText } from "../dom/elements.ts";

export type DialogIdentifier = "add-dialog" | "delete-dialog";

export class ChannelDialogsView {
  readonly controls;
  readonly #focusTargets = new Map<DialogIdentifier, HTMLElement>();
  readonly #fallback;
  readonly #deleteName;
  readonly #confirmAdd;
  readonly #confirmDelete;
  readonly #addError;
  readonly #deleteError;

  constructor(document: Document) {
    this.controls = {
      addForm: element(document, "add-form", "form"),
      deleteForm: element(document, "delete-form", "form"),
      identifier: element(document, "new-channel-id", "input"),
      name: element(document, "new-channel-name", "input"),
      dialogs: {
        "add-dialog": element(document, "add-dialog", "dialog"),
        "delete-dialog": element(document, "delete-dialog", "dialog"),
      },
      closeButtons: document.querySelectorAll<HTMLButtonElement>("[data-close-dialog]"),
    };
    this.#fallback = element(document, "add-channel", "button");
    this.#deleteName = element(document, "delete-channel-name", "strong");
    this.#confirmAdd = element(document, "confirm-add", "button");
    this.#confirmDelete = element(document, "confirm-delete", "button");
    this.#addError = element(document, "add-error", "div");
    this.#deleteError = element(document, "delete-error", "div");
  }

  openAdd(invoker: HTMLElement = this.#fallback): void {
    this.controls.addForm.reset();
    this.clearAddError();
    this.#focusTargets.set("add-dialog", invoker);
    this.controls.dialogs["add-dialog"].showModal();
  }

  openDelete(channel: Channel, invoker: HTMLElement): void {
    setText(this.#deleteName, channel.name || channel.id);
    this.#deleteError.hidden = true;
    this.#focusTargets.set("delete-dialog", invoker);
    this.controls.dialogs["delete-dialog"].showModal();
  }

  close(identifier: DialogIdentifier): void {
    this.controls.dialogs[identifier].close();
    this.restoreFocus(identifier);
  }

  restoreFocus(identifier: DialogIdentifier): void {
    const target = this.#focusTargets.get(identifier);
    if (!target) return;
    this.#focusTargets.delete(identifier);
    (target.isConnected && !isDisabled(target) && target.getClientRects().length ? target : this.#fallback)
      .focus({ preventScroll: true });
  }

  focusAdd(): void { this.#fallback.focus({ preventScroll: true }); }

  clearAddError(): void {
    this.controls.identifier.removeAttribute("aria-invalid");
    this.#addError.hidden = true;
  }

  markInvalid(): void {
    this.controls.identifier.setAttribute("aria-invalid", "true");
    this.controls.identifier.focus();
  }

  renderControls(operation: Operation | null): void {
    const dialogs: [DialogIdentifier, Operation][] = [["add-dialog", "add"], ["delete-dialog", "delete"]];
    for (const [identifier, action] of dialogs) {
      for (const control of this.controls.dialogs[identifier].querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input")) {
        control.disabled = operation === action;
      }
    }
    this.controls.addForm.setAttribute("aria-busy", String(operation === "add"));
    this.controls.deleteForm.setAttribute("aria-busy", String(operation === "delete"));
    setText(this.#confirmAdd, operation === "add" ? "추가 중…" : "추가");
    setText(this.#confirmDelete, operation === "delete" ? "삭제 중…" : "채널 삭제");
  }
}
