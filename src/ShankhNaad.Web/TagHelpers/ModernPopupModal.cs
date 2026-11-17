using Microsoft.AspNetCore.Razor.TagHelpers;

namespace ShankhNaad.Web.TagHelpers
{
    /// <summary>
    /// Renders the single shared Add/Edit modal shell that
    /// FetchModernInputModalAndShow (modern-input-with-search.js) opens
    /// and fills — the overlay, the draggable window, the header
    /// icon badge + title, the content holder that partial views get
    /// injected into, and the footer Save button.
    ///
    /// This tag helper only emits the HTML markup. The CSS that styles
    /// it (.OverlayForAddEditDelete, .ModalAddEditCopy, .GlassIconBadge,
    /// etc.) and the JS that opens/drives it (modern-input-with-search.js)
    /// are expected to already be loaded separately in the layout, the
    /// same as before — this control does not inline either.
    ///
    /// Usage — add ONCE in _Layout.cshtml, typically right before
    /// </body>, alongside wherever the modern-input-with-search script
    /// is loaded:
    ///
    ///   <modern-popup-modal />
    ///
    /// All the ids this emits (AddEditOverlay, PopupWindow, MoveWindow,
    /// btnCloseModal, ModalIcon, Title, modalContainerHolder) are the
    /// FIXED ids modern-input-with-search.js already targets directly
    /// (see FetchModernInputModalAndShow) — they are not
    /// parameterized, because there is exactly one of this shell per
    /// page and every outside-search-button / add-edit button on the
    /// page opens the same one.
    ///
    /// The Save button sits in the glass footer bar, styled like the full-page
    /// window's Save (cee-btn cee-btn-gradient). It is HIDDEN unless the button
    /// that opened the modal sets OutsideSearchSaveBtnId{n} (save-btn-id1="..."):
    /// plain pick-a-row list windows need no Save, so none is shown there.
    ///
    /// The Save button is the one exception: its id is NOT fixed. It
    /// starts as id='btnSave' in this markup, but
    /// FetchModernInputModalAndShow re-sets it on every open, from the
    /// clicked button's OutsideSearchSaveBtnId{n} (falling back to
    /// 'btnSave' when that isn't set) — so a page can bind a click
    /// handler to whatever id it configured for the button that opened
    /// the modal, e.g. $('#btnSaveAgent').on('click', ...). The button
    /// always carries data-role='modal-save-btn' as a STABLE selector
    /// that never changes, which is what the JS uses to find and
    /// re-id the button in the first place — use that selector, not a
    /// hardcoded #btnSave, in any code that needs to find the Save
    /// button regardless of its current id.
    ///
    /// #ModalIcon is emitted with no class attribute (only its base
    /// font-size), matching the fact that FetchModernInputModalAndShow
    /// always sets #ModalIcon's class itself on every open (either from
    /// the clicked button's OutsideSearchModalIcon{n} / data-modal-icon,
    /// or its own hardcoded default) — a class placed here would just be
    /// overwritten immediately, so none is rendered.
    ///
    /// Note: this project loads Font Awesome 4.7 (font-awesome-4.7.0),
    /// which only understands the "fa fa-&lt;name&gt;" class pattern —
    /// there is no fa-solid/fa-regular/fa-brands prefix in that version,
    /// and only icon names that existed as of FA 4.7 will render. Any
    /// icon class passed into OutsideSearchModalIcon1/2 elsewhere in the
    /// app needs to follow that same FA4 syntax, or nothing will render
    /// even though the class attribute gets set correctly.
    /// </summary>
    [HtmlTargetElement("modern-popup-modal")]
    public class ModernPopupModal : TagHelper
    {
        public override void Process(TagHelperContext context, TagHelperOutput output)
        {
            output.TagName = null; // this tag itself contributes no wrapping element — just its rendered content
            output.TagMode = TagMode.StartTagAndEndTag;

            output.Content.SetHtmlContent(@"
<div id='AddEditOverlay' class='OverlayForAddEditDelete'></div>
<div class='ModalAddEditCopy' id='PopupWindow' style='height:70%; width:60%;'>

    <div style='height: 100%; width: 100%'>
        <div class='RightAddEditCopy'>

            <div id='MoveWindow' class='MoveWindowHandle'></div>
            <a class='btnModalCloseModal ripple buttonshadow notranslate' id='btnCloseModal' title='Close'>X</a>

            <div class='ModalHeaderRow'>
                <div class='GlassIconBadge'>
                    <div class='badge-orb'></div>
                    <div class='badge-glass'></div>
                    <i id='ModalIcon' style='font-size:22px'></i>
                </div>
                <h2 id='Title' class='glow-title'></h2>
            </div>

            <div class='PARTBase'>
                <div id='modalContainerHolder' class='PARTMainContentForHolddata AnimatedAppear'>
                </div>
            </div>

            <div class='AddEditModalFooterCurve'>
                <div class='FooterBackgroundClip'></div>
                <div class='ModalFooterButtons' style='position:relative; z-index:2; height:100%; display:flex; align-items:center; justify-content:flex-end; padding:0 24px; box-sizing:border-box;'>
                    <button type='button' class='cee-btn cee-btn-gradient' data-role='modal-save-btn' id='btnSave' style='display:none;'><i class='fa fa-save' aria-hidden='true'></i> Save</button>
                </div>
            </div>
        </div>

    </div>
</div>
");
        }
    }
}