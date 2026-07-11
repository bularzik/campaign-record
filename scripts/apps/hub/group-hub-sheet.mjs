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
    const page = this.document.pages.get(pageId);
    return page ? this.navigateToRecord(page.uuid) : undefined;
  }

  /**
   * This sheet's root <form> wraps the record pane and the hub's own UI
   * inputs. Pressing Enter in any of them fires an implicit form submission,
   * which DocumentSheetV2 would serialize (junk keys like `system.*` from
   * pane-mounted record views, `tag-filter`, `sort-select`, ...) and write to
   * the group JournalEntry. Per DEFAULT_OPTIONS.form above: the hub's inputs
   * are UI state, not document fields — never submit them. Record-view edits
   * persist through the record sheets' own change listeners.
   */
  _processFormData() {
    return {};
  }

  /** Belt and braces with _processFormData: never write the group document. */
  async _processSubmitData() {}
}
