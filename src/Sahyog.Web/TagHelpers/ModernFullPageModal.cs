using Microsoft.AspNetCore.Razor.TagHelpers;

namespace Sahyog.Web.TagHelpers
{
    /// <summary>
    /// Renders the single shared full-page Add/Edit window shell —
    /// the overlay, the left sidebar (grid areas box-1AA..box-1F,
    /// including the stacked Add/Edit icon badges and the
    /// heading/subheading), the right content holder that a full page
    /// gets loaded into dynamically, and the footer Cancel/Save buttons.
    ///
    /// This tag helper only emits the HTML markup. The CSS that lays it
    /// out (.modalContainer-full-page grid areas, .cardholder,
    /// .fa-stack, etc.) and the JS that opens/drives it — showing this
    /// overlay, toggling #AddIcon vs #EditIcon, loading a page into
    /// #FullScreenModalContainer, and wiring #btnCloseFullPageWindow /
    /// #btnSaveData — are expected to already be loaded separately in
    /// the layout, the same as before this tag helper existed; this
    /// control does not inline either.
    ///
    /// Usage — add ONCE in _Layout.cshtml, typically right before
    /// </body> alongside <modern-popup-modal /> and wherever the
    /// driving JS is loaded:
    ///
    ///   <modern-full-page-modal />
    ///
    /// AddEditPageName is the sub heading under "All field with * Mandatory"
    /// that shows the page the window was opened from (e.g. "Department").
    /// FetchFullModalAndShow (global.js) fills it each time the window opens;
    /// it stays hidden when there is no page name.
    ///
    /// All the ids this emits (AddEditOverlayForfullpagewindow,
    /// AddEditTitle, AddEditPageName, AddIcon, EditIcon, FullScreenModalContainer,
    /// btnCloseFullPageWindow, btnSaveData) are FIXED ids the page's
    /// existing JS already targets directly — they are not
    /// parameterized, because there is exactly one of this shell per
    /// page and every "open full page" action on the page opens the
    /// same one.
    /// </summary>
    [HtmlTargetElement("modern-full-page-modal")]
    public class ModernFullPageModal : TagHelper
    {
        public override void Process(TagHelperContext context, TagHelperOutput output)
        {
            output.TagName = null; // this tag itself contributes no wrapping element — just its rendered content
            output.TagMode = TagMode.StartTagAndEndTag;

            output.Content.SetHtmlContent(@"
<div id='AddEditOverlayForfullpagewindow' class='modalContainer-full-page'>
    <div class='Left-Side-bar' style='grid-area: box-Side-Bar-Left'></div>
    <div class='Top' style='grid-area: box-Top'></div>
    <div class='windowBody' style='grid-area: box-Body'>
        <div class='Left'>
            <div class='box-1AA'></div>
            <div class='box-1BB'></div>
            <div class='box-1CC'></div>
            <div class='box-1DD'>
                <div class='headingData'>
                    <h5 id='AddEditTitle' class='AddEditheading'> </h5>
                    <h6 class='AddEditsubheading' style='translate: -9px 0;'>All field with <span class='asterisk'>  * </span> Mandatory</h6>
                    <h6 id='AddEditPageName' class='AddEditsubheading AddEditPageName' style='display:none; translate: -9px 0; font-size:15px; font-weight:700; margin-top:4px;'></h6>
                </div>
            </div>
            <div class='box-1E'>
                <div class='cardholder' style='translate: 0 18px;'>
                    <span id='AddIcon' class='fa-stack' style='display:none'>
                        <i class='fa fa-file-o fa-stack-2x'></i>
                        <i class='fa fa-plus fa-stack-1x fa-badge'></i>
                    </span>
                    <span id='EditIcon' class='fa-stack edit-stack' style='display:none'>
                        <i class='fa fa-square-o fa-stack-2x'></i>
                        <i class='fa fa-pencil fa-stack-1x edit-pencil'></i>
                    </span>
                </div>
            </div>
            <div class='box-1F'></div>
        </div>
        <div class='Right strict-shadow'>
            <div id='FullScreenModalContainer' class='right1' style='grid-area: rightbox-1'>
            </div>
            <div class='right2 strict-top-shadow' style='grid-area: rightbox-2'>
                <button id='btnCloseFullPageWindow' class='cee-btn cee-btn-cancel' style='opacity: 0;'><i class='fa fa-times' aria-hidden='true'></i> Cancel</button>
                <button id='btnSaveData' class='cee-btn cee-btn-gradient' style='opacity: 0;'><i class='fa fa-save' aria-hidden='true'></i> Save</button>
            </div>

        </div>
    </div>
</div>
");
        }
    }
}