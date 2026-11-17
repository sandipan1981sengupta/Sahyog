using Microsoft.AspNetCore.Razor.TagHelpers;
using System.Linq;

namespace ShankhNaad.Web.TagHelpers
{
    /// <summary>
    /// Sidebar navigation container. Requires Font Awesome for icons
    /// (already used by modern-table's icon property):
    /// https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css
    ///
    /// Usage:
    /// <modern-sidebar id="MainNav" theme="light" sidebar-height="600px"
    ///                  user-name="John Smith" user-email="jnsmith99@gmail.com"
    ///                  user-avatar-url="https://i.pravatar.cc/100?img=12">
    ///     <sidebar-menu-item label="Dashboard" icon="th-large" href="/Dashboard"></sidebar-menu-item>
    ///     <sidebar-menu-item label="Customers" icon="users" active="true">
    ///         <sidebar-menu-item label="Badges" href="/Customers/Badges" active="true"></sidebar-menu-item>
    ///     </sidebar-menu-item>
    ///
    ///     <sidebar-footer-menu>
    ///         <sidebar-menu-item label="Settings" icon="cog" href="/Settings"></sidebar-menu-item>
    ///         <sidebar-menu-item label="Logout" icon="sign-out" href="/Logout"></sidebar-menu-item>
    ///     </sidebar-footer-menu>
    /// </modern-sidebar>
    ///
    /// Anything inside &lt;sidebar-footer-menu&gt; renders in a fixed
    /// section at the bottom (above the user profile), which never
    /// scrolls — only the main menu list above it scrolls, within
    /// whatever sidebar-height you set.
    ///
    /// User avatar: if UserAvatarUrl is set, that image is shown
    /// (cropped to a circle via CSS). If it's missing or fails to load,
    /// a circular fallback badge with the user's initials is shown
    /// instead, so you never end up with an empty/broken image.
    /// </summary>
    [HtmlTargetElement("modern-sidebar")]
    [RestrictChildren("sidebar-menu-item", "sidebar-footer-menu")]
    public class ModernSidebar : TagHelper
    {
        private const string FooterStartMarker = "<!--SIDEBAR_FOOTER_MENU_START-->";
        private const string FooterEndMarker = "<!--SIDEBAR_FOOTER_MENU_END-->";

        public string Id { get; set; }
        public bool Collapsed { get; set; } = false;    // icon-only collapsed state
        public string Theme { get; set; } = "light";      // "light" or "dark"
        public string SidebarHeight { get; set; } = "600px";  // fixed overall height — only the main menu list scrolls inside it; e.g. "100vh" also works
        public string SidebarWidth { get; set; } = "260px";     // e.g. "350px"
        public bool ShowBorder { get; set; } = true;               // outer card border
        public bool ShowToggleButton { get; set; } = false;          // hamburger collapse/expand button in the header
        public bool ShowLogo { get; set; } = false;                    // logo square in the header

        public string BackgroundColor { get; set; }               // optional — accepts any CSS color including rgba(); overrides the theme's default background. Theme is not required if this is set.
        public string MenuFontSize { get; set; } = "14px";           // main-level menu items
        public string MenuFontWeight { get; set; } = "600";
        public string SubmenuFontSize { get; set; } = "13.5px";       // nested submenu items
        public string SubmenuFontWeight { get; set; } = "500";
        public string IconSize { get; set; } = "18px";                 // applies to every item's icon, main and nested alike
        public string SelectionColor { get; set; }                       // optional — overrides the active/selected item's background in both themes
        public string HoverColor { get; set; }                      // optional — background color when hovering any menu item; overrides theme default
        public string SubmenuBackgroundColor { get; set; }            // optional — background of the submenu panel (the block shown when a parent item is expanded); overrides theme default

        // Optional footer profile block (bottom of the sidebar) — omit
        // UserName to skip rendering the footer entirely
        public string UserName { get; set; }
        public string UserEmail { get; set; }
        public string UserAvatarUrl { get; set; }                    // optional — rounded profile photo. If missing/broken, initials are shown instead
        public string UserAvatarBg { get; set; }                     // optional — background color of the initials fallback badge
        public string UserNameColor { get; set; }                    // optional — overrides theme default
        public string UserNameFontSize { get; set; } = "13.5px";
        public string UserNameFontWeight { get; set; } = "700";

        public override async Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
        {
            var childContent = await output.GetChildContentAsync();
            var rawContent = childContent.GetContent();

            // Split out anything from <sidebar-footer-menu> (marked with
            // HTML comments by that Tag Helper) from the regular,
            // scrollable menu items.
            string mainItemsHtml = rawContent;
            string footerItemsHtml = "";

            var startIdx = rawContent.IndexOf(FooterStartMarker, StringComparison.Ordinal);
            var endIdx = rawContent.IndexOf(FooterEndMarker, StringComparison.Ordinal);
            if (startIdx >= 0 && endIdx > startIdx)
            {
                footerItemsHtml = rawContent.Substring(startIdx + FooterStartMarker.Length, endIdx - startIdx - FooterStartMarker.Length);
                mainItemsHtml = rawContent.Substring(0, startIdx) + rawContent.Substring(endIdx + FooterEndMarker.Length);
            }

            output.TagName = "div";
            var collapsedClass = Collapsed ? " ms-collapsed" : "";
            var themeClass = (Theme ?? "light").ToLower() == "dark" ? " ms-dark" : "";
            var noBorderClass = ShowBorder ? "" : " ms-no-border";
            output.Attributes.SetAttribute("class", $"modern-sidebar{collapsedClass}{themeClass}{noBorderClass}");
            output.Attributes.SetAttribute("id", Id);

            var styleVars = new System.Collections.Generic.List<string>
            {
                $"height:{SidebarHeight}",
                $"width:{SidebarWidth}",
                $"--ms-user-name-size:{UserNameFontSize}",
                $"--ms-user-name-weight:{UserNameFontWeight}",
                $"--ms-menu-font-size:{MenuFontSize}",
                $"--ms-menu-font-weight:{MenuFontWeight}",
                $"--ms-submenu-font-size:{SubmenuFontSize}",
                $"--ms-submenu-font-weight:{SubmenuFontWeight}",
                $"--ms-icon-size:{IconSize}"
            };
            if (!string.IsNullOrWhiteSpace(BackgroundColor)) styleVars.Add($"background:{BackgroundColor}");
            if (!string.IsNullOrWhiteSpace(HoverColor)) styleVars.Add($"--ms-hover-color:{HoverColor}");
            if (!string.IsNullOrWhiteSpace(SubmenuBackgroundColor)) styleVars.Add($"--ms-submenu-bg:{SubmenuBackgroundColor}");
            if (!string.IsNullOrWhiteSpace(SelectionColor)) styleVars.Add($"--ms-selection-color:{SelectionColor}");
            if (!string.IsNullOrWhiteSpace(UserNameColor)) styleVars.Add($"--ms-user-name-color:{UserNameColor}");
            if (!string.IsNullOrWhiteSpace(UserAvatarBg)) styleVars.Add($"--ms-avatar-bg:{UserAvatarBg}");

            output.Attributes.SetAttribute("style", string.Join("; ", styleVars) + ";");

            var toggleBtnHtml = ShowToggleButton ? @"
                <button class='ms-toggle-btn' type='button' aria-label='Toggle sidebar'>
                    <svg width='18' height='18' viewBox='0 0 18 18' fill='none'><path d='M2 4.5H16M2 9H16M2 13.5H16' stroke='currentColor' stroke-width='1.6' stroke-linecap='round'/></svg>
                </button>" : "";

            var logoHtml = ShowLogo ? "<span class='ms-logo'></span>" : "";

            // Skip the whole header block if there's nothing in it
            var headerHtml = (ShowLogo || ShowToggleButton) ? $@"
                <div class='ms-header'>
                    {logoHtml}
                    {toggleBtnHtml}
                </div>" : "";

            // ---- Avatar: real image (rounded via CSS) with an
            // initials fallback if the URL is missing or fails to load ----
            var initials = GetInitials(UserName);
            var hasAvatarUrl = !string.IsNullOrWhiteSpace(UserAvatarUrl);

            var avatarImgHtml = hasAvatarUrl
                ? $@"<img class='ms-avatar' src='{UserAvatarUrl}' alt='{UserName}'
                        onerror=""this.style.display='none'; this.nextElementSibling.style.display='flex';"" />"
                : "";

            var avatarFallbackHtml = $@"<span class='ms-avatar ms-avatar-fallback'
                    style='display:{(hasAvatarUrl ? "none" : "flex")};'>{initials}</span>";

            var footerProfileHtml = !string.IsNullOrWhiteSpace(UserName) ? $@"
                <div class='ms-footer'>
                    <span class='ms-avatar-wrap'>
                        {avatarImgHtml}
                        {avatarFallbackHtml}
                        <span class='ms-status-dot'></span>
                    </span>
                    <div class='ms-user-info'>
                        <div class='ms-user-name'>{UserName}</div>
                        <div class='ms-user-email'>{UserEmail}</div>
                    </div>
                    <button class='ms-more-btn' type='button' aria-label='More options'>
                        <svg width='16' height='16' viewBox='0 0 16 16' fill='none'><circle cx='8' cy='3' r='1.3' fill='currentColor'/><circle cx='8' cy='8' r='1.3' fill='currentColor'/><circle cx='8' cy='13' r='1.3' fill='currentColor'/></svg>
                    </button>
                </div>" : "";

            var fixedBottomHtml = (!string.IsNullOrWhiteSpace(footerItemsHtml) || !string.IsNullOrWhiteSpace(footerProfileHtml)) ? $@"
                <div class='ms-fixed-bottom'>
                    <ul class='ms-menu-list ms-footer-menu-list'>
                        {footerItemsHtml}
                    </ul>
                    {footerProfileHtml}
                </div>" : "";

            output.Content.SetHtmlContent($@"
                {headerHtml}
                <nav class='ms-nav'>
                    <ul class='ms-menu-list ms-level-0'>
                        {mainItemsHtml}
                    </ul>
                </nav>
                {fixedBottomHtml}
            ");
        }

        private static string GetInitials(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return "";
            var parts = name.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var chars = parts.Take(2).Select(w => char.ToUpper(w[0]));
            return string.Concat(chars);
        }
    }

    /// <summary>
    /// Wraps &lt;sidebar-menu-item&gt; entries that should render in the
    /// fixed bottom section (never scrolls), above the user profile —
    /// typically "Settings" / "Logout" style items.
    /// </summary>
    [HtmlTargetElement("sidebar-footer-menu")]
    [RestrictChildren("sidebar-menu-item")]
    public class SidebarFooterMenu : TagHelper
    {
        public override async Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
        {
            var childContent = await output.GetChildContentAsync();
            var itemsHtml = childContent.GetContent();

            output.TagName = null;   // this tag itself renders nothing — just marks its content for ModernSidebar to extract
            output.Content.SetHtmlContent($"<!--SIDEBAR_FOOTER_MENU_START-->{itemsHtml}<!--SIDEBAR_FOOTER_MENU_END-->");
        }
    }

    /// <summary>
    /// A single menu entry. Can be a plain link (leaf) or, if it contains
    /// nested &lt;sidebar-menu-item&gt; tags, a collapsible parent — nesting
    /// works to any depth, since each level is just another of these.
    /// </summary>
    [HtmlTargetElement("sidebar-menu-item")]
    [RestrictChildren("sidebar-menu-item")]
    public class SidebarMenuItem : TagHelper
    {
        public string Label { get; set; }
        public string LabelColor { get; set; }             // optional — overrides theme's default text color for this item
        public string Icon { get; set; }                     // Font Awesome icon name, e.g. "th-large", "users", "cog"
        public string IconColor { get; set; }                  // optional — overrides theme's default icon color for this item
        public string Href { get; set; } = "#";
        public bool Active { get; set; } = false;                // highlights this item as the current page
        public bool DefaultOpen { get; set; } = false;             // whether this item's submenu starts expanded
        public string IconFontSize { get; set; } = "22px";              //IconFontSize

        public override async Task ProcessAsync(TagHelperContext context, TagHelperOutput output)
        {
            var childContent = await output.GetChildContentAsync();
            var nestedHtml = childContent.GetContent();
            var hasChildren = !string.IsNullOrWhiteSpace(nestedHtml.ToString().Trim());

            output.TagName = "li";
            var classes = "ms-menu-item" + (hasChildren ? " ms-has-children" : "") + (Active ? " ms-active" : "") + (DefaultOpen ? " ms-open" : "");
            output.Attributes.SetAttribute("class", classes);

            var iconHtml = !string.IsNullOrWhiteSpace(Icon)
                ? $"<i class='fa fa-{Icon} ms-item-icon' style='{(!string.IsNullOrWhiteSpace(IconColor) ? $"color:{IconColor}; " : "")}{(!string.IsNullOrWhiteSpace(IconFontSize) ? $"font-size:{IconFontSize}; " : "")}'></i>"
                : "<span class='ms-item-icon-spacer'></span>";

            var labelStyle = !string.IsNullOrWhiteSpace(LabelColor) ? $"style='color:{LabelColor};'" : "";

            var chevronHtml = hasChildren
                ? "<svg class='ms-chevron' width='10' height='10' viewBox='0 0 10 10' fill='none'><path d='M2 3.5L5 6.5L8 3.5' stroke='currentColor' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>"
                : "";

            var linkTag = hasChildren ? "button" : "a";
            var linkAttrs = hasChildren
                ? "type='button' class='ms-item-link' data-toggle='true'"
                : $"href='{Href}' class='ms-item-link'";

            var submenuHtml = hasChildren
                ? $"<ul class='ms-submenu{(DefaultOpen ? " ms-open" : "")}'>{nestedHtml}</ul>"
                : "";

            output.Content.SetHtmlContent($@"
                <{linkTag} {linkAttrs}>
                    {iconHtml}
                    <span class='ms-item-label' {labelStyle}>{Label}</span>
                    {chevronHtml}
                </{linkTag}>
                {submenuHtml}
            ");
        }
    }
}