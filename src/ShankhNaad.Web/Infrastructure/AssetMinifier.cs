using System.Text;

namespace ShankhNaad.Web.Infrastructure;

/// <summary>
/// A careful, "safe only" minifier for our own CSS and JS: it removes comments and extra spaces, nothing else.
///
/// - No renaming, no rewriting, no reordering: the code that runs is exactly the code in wwwroot, minus
///   comments and indentation. Strings, template literals (`…${…}…`), regular expressions and CSS url(…)
///   are copied untouched.
/// - JS keeps its line breaks, so automatic semicolons (a line without ";") work exactly as before.
/// - CSS keeps the space after "," and every space inside values (calc(a + b), var(--x, y)).
/// - Checked against real parsers on every .js / .css file of the project (the same parse before and after).
/// - Files under lib/ and *.min.* files are already minified and are not touched (see <see cref="ShouldMinify"/>).
/// - If anything goes wrong the original text is used ("App:MinifyAssets": false turns it off completely).
/// </summary>
public static class AssetMinifier
{
    /// <summary>Our own files only: libraries (lib/…, *.min.*) are left as they are; the service worker too.</summary>
    public static bool ShouldMinify(string relPath)
    {
        var p = relPath.Replace('\\', '/').TrimStart('/').ToLowerInvariant();
        if (p.StartsWith("lib/") || p.Contains(".min.") || p.EndsWith("service-worker.js")) return false;
        return p.EndsWith(".js") || p.EndsWith(".css");
    }

    /// <summary>The minified text, or the original text if the file shouldn't be (or couldn't be) minified.</summary>
    public static string Minify(string relPath, string text)
    {
        if (!ShouldMinify(relPath) || string.IsNullOrEmpty(text)) return text;
        try
        {
            var p = relPath.ToLowerInvariant();
            var result = p.EndsWith(".css") ? Css(text) : Js(text);
            // a result that lost almost everything means something is off: keep the original
            return result.Length < text.Length / 5 && text.Length > 2000 ? text : result;
        }
        catch
        {
            return text;
        }
    }

    // =====================================================================
    // JavaScript: comments out, indentation and blank lines out, runs of spaces → one space.
    // =====================================================================
    private const string JsNoSpace = "{}()[];,:=";
    private const string RegexAfter = "(,=:[!&|?{};+-*%<>~^";
    private static readonly HashSet<string> RegexAfterWords = new(StringComparer.Ordinal)
        { "return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "instanceof", "yield", "await" };

    private static bool IsWord(char c) => char.IsLetterOrDigit(c) || c == '_' || c == '$' || c >= '\u0080';
    private static bool IsSpace(char c) => c == ' ' || c == '\t' || c == '\f' || c == '\v' || c == ' ' || c == '﻿';

    public static string Js(string src)
    {
        var w = new JsWriter(src);
        w.Code(false);
        return w.Out.ToString().Trim() + "\n";
    }

    private sealed class JsWriter
    {
        private readonly string _src;
        private readonly int _n;
        private int _i;
        private char _lastSig;          // '\0' = nothing yet; 'w' = a word, number, regex; '"' = a string / template
        private string _lastWord = "";
        public readonly StringBuilder Out;

        public JsWriter(string src) { _src = src; _n = src.Length; Out = new StringBuilder(src.Length); }

        private char Last => Out.Length > 0 ? Out[^1] : '\0';

        private void Space()
        {
            var l = Last;
            if (l != '\0' && l != ' ' && l != '\n') Out.Append(' ');
        }

        private void NewLine()
        {
            while (Out.Length > 0 && Out[^1] == ' ') Out.Length--;
            if (Out.Length > 0 && Out[^1] != '\n') Out.Append('\n');
        }

        /// <summary>A token: a single space before it is dropped when either side is { } ( ) [ ] ; , : =</summary>
        private void Emit(string s)
        {
            if (Out.Length >= 2 && Out[^1] == ' ' && (JsNoSpace.IndexOf(Out[^2]) >= 0 || JsNoSpace.IndexOf(s[0]) >= 0)) Out.Length--;
            Out.Append(s);
        }

        private bool RegexAllowed() =>
            _lastSig == '\0' || RegexAfter.IndexOf(_lastSig) >= 0 || (_lastSig == 'w' && RegexAfterWords.Contains(_lastWord));

        /// <summary>Code; inside a template's ${…} it returns at the matching "}" (not consumed).</summary>
        public void Code(bool inTemplate)
        {
            var depth = 0;
            while (_i < _n)
            {
                var c = _src[_i];
                var d = _i + 1 < _n ? _src[_i + 1] : '\0';
                if (c == '/' && d == '/')
                {
                    while (_i < _n && _src[_i] != '\n') _i++;
                    continue;
                }
                if (c == '/' && d == '*')
                {
                    var e = _src.IndexOf("*/", _i + 2, StringComparison.Ordinal);
                    var end = e < 0 ? _n : e + 2;
                    var hadLine = _src.IndexOf('\n', _i, end - _i) >= 0;
                    _i = end;
                    if (hadLine) NewLine(); else Space();
                    continue;
                }
                if (c == '\n' || c == '\r') { NewLine(); _i++; continue; }
                if (IsSpace(c)) { Space(); _i++; continue; }
                if (c == '\'' || c == '"')
                {
                    var j = _i + 1;
                    while (j < _n && _src[j] != c) { if (_src[j] == '\\') j++; j++; }
                    var stop = Math.Min(j + 1, _n);
                    Emit(_src[_i..stop]);
                    _i = stop;
                    _lastSig = '"';
                    continue;
                }
                if (c == '`') { Template(); _lastSig = '"'; continue; }
                if (c == '/' && RegexAllowed())
                {
                    var j = _i + 1;
                    var inClass = false;
                    while (j < _n)
                    {
                        var x = _src[j];
                        if (x == '\\') { j += 2; continue; }
                        if (x == '[') inClass = true;
                        else if (x == ']') inClass = false;
                        else if (x == '/' && !inClass) break;
                        else if (x == '\n') break;
                        j++;
                    }
                    var stop = Math.Min(j + 1, _n);
                    Emit(_src[_i..stop]);
                    _i = stop;
                    _lastSig = 'w'; _lastWord = "";
                    continue;
                }
                if (inTemplate)
                {
                    if (c == '{') depth++;
                    else if (c == '}') { if (depth == 0) return; depth--; }
                }
                if (IsWord(c))
                {
                    var j = _i;
                    while (j < _n && IsWord(_src[j])) j++;
                    var word = _src[_i..j];
                    Emit(word);
                    _i = j;
                    _lastSig = 'w'; _lastWord = word;
                    continue;
                }
                Emit(c.ToString());
                _i++;
                _lastSig = c;
            }
        }

        /// <summary>`text ${code} text`: the text parts are copied exactly; the code parts are minified.</summary>
        private void Template()
        {
            var start = _i;
            var j = _i + 1;
            while (j < _n)
            {
                var x = _src[j];
                if (x == '\\') { j += 2; continue; }
                if (x == '`') { j++; break; }
                if (x == '$' && j + 1 < _n && _src[j + 1] == '{')
                {
                    Emit(_src[start..(j + 2)]);
                    _i = j + 2;
                    _lastSig = '{';
                    Code(true);                       // stops at the matching }
                    Out.Append('}');
                    _i++;
                    start = _i; j = _i;
                    continue;
                }
                j++;
            }
            j = Math.Min(j, _n);
            Out.Append(_src, start, j - start);
            _i = j;
        }
    }

    // =====================================================================
    // CSS: comments out, runs of spaces → one space, no space around { } ;, no ";" before "}".
    // =====================================================================
    private const string CssNoSpace = "{};";

    public static string Css(string src)
    {
        var o = new StringBuilder(src.Length);
        var n = src.Length;
        var i = 0;
        char Last() => o.Length > 0 ? o[^1] : '\0';
        void Emit(string s)
        {
            if (o.Length >= 1 && o[^1] == ' ' && (CssNoSpace.IndexOf(s[0]) >= 0 || (o.Length >= 2 && CssNoSpace.IndexOf(o[^2]) >= 0))) o.Length--;
            if (s == "}" && Last() == ';') o.Length--;
            o.Append(s);
        }
        while (i < n)
        {
            var c = src[i];
            if (c == '/' && i + 1 < n && src[i + 1] == '*')
            {
                var e = src.IndexOf("*/", i + 2, StringComparison.Ordinal);
                i = e < 0 ? n : e + 2;
                if (o.Length > 0 && Last() != ' ') o.Append(' ');
                continue;
            }
            if (char.IsWhiteSpace(c))
            {
                if (o.Length > 0 && Last() != ' ') o.Append(' ');
                i++;
                continue;
            }
            if (c == '\'' || c == '"')
            {
                var j = i + 1;
                while (j < n && src[j] != c) { if (src[j] == '\\') j++; j++; }
                var stop = Math.Min(j + 1, n);
                Emit(src[i..stop]);
                i = stop;
                continue;
            }
            if ((c == 'u' || c == 'U') && i + 4 <= n && string.Compare(src, i, "url(", 0, 4, StringComparison.OrdinalIgnoreCase) == 0)
            {
                var j = i + 4;
                while (j < n && char.IsWhiteSpace(src[j])) j++;
                if (j < n && src[j] != '"' && src[j] != '\'')
                {
                    var e = src.IndexOf(')', j);
                    var stop = e < 0 ? n : e + 1;
                    Emit(src[i..stop]);
                    i = stop;
                    continue;
                }
            }
            Emit(c.ToString());
            i++;
        }
        while (o.Length > 0 && o[^1] == ' ') o.Length--;
        return o.ToString().Trim() + "\n";
    }
}
