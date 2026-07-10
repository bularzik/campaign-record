import { HubMixin } from "./hub-mixin.mjs";

const { DocumentSheetV2 } = foundry.applications.api;

/** The Campaign Hub rendered as a group's own JournalEntry sheet. */
export class GroupHubSheet extends HubMixin(DocumentSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["group-hub"],
    window: { resizable: true, icon: "fa-solid fa-book-atlas" },
    position: { width: 760, height: 640 },
    // The hub's inputs are UI state, not document fields — never submit them.
    form: { submitOnChange: false, closeOnSubmit: false }
  };

  get groupScopeId() {
    return this.document.id;
  }

  get showsGroupPicker() {
    return false;
  }

  /** Core JournalEntrySheet API compat: content links and callers land in-pane. */
  goToPage(pageId) {
    return this.navigateToRecord(pageId);
  }
}
