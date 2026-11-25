using System.IO.Compression;
using System.Security;
using System.Text;

namespace ShankhNaad.Web.Infrastructure;

/// <summary>
/// A small, dependency-free Excel (.xlsx) writer for simple sheets: one worksheet, text and numbers,
/// a bold title, bold column headings, column widths and a frozen heading row. Opens in Excel,
/// Google Sheets, LibreOffice and Numbers.
/// </summary>
public sealed class XlsxWriter
{
    private readonly List<(int Style, object?[] Cells)> _rows = new();
    private readonly List<double> _widths = new();
    private int _freezeAfterRow;

    /// <summary>0 = normal, 1 = bold, 2 = big bold title, 3 = heading (bold, shaded, border), 4 = grey note.</summary>
    public XlsxWriter Row(int style, params object?[] cells) { _rows.Add((style, cells)); return this; }
    public XlsxWriter Blank() => Row(0);
    public XlsxWriter Widths(params double[] widths) { _widths.Clear(); _widths.AddRange(widths); return this; }
    /// <summary>Keep the rows up to this one (1-based) in view while scrolling.</summary>
    public XlsxWriter FreezeAfter(int row) { _freezeAfterRow = row; return this; }

    public byte[] Build(string sheetName)
    {
        sheetName = new string((sheetName ?? "Sheet1").Where(c => !"[]:*?/\\".Contains(c)).ToArray());
        if (sheetName.Length == 0) sheetName = "Sheet1";
        if (sheetName.Length > 31) sheetName = sheetName[..31];

        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            Add(zip, "[Content_Types].xml",
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
                "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
                "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
                "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>" +
                "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>" +
                "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>" +
                "</Types>");
            Add(zip, "_rels/.rels",
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>" +
                "</Relationships>");
            Add(zip, "xl/workbook.xml",
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">" +
                $"<sheets><sheet name=\"{Esc(sheetName)}\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>");
            Add(zip, "xl/_rels/workbook.xml.rels",
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>" +
                "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>" +
                "</Relationships>");
            Add(zip, "xl/styles.xml",
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">" +
                "<fonts count=\"4\">" +
                "<font><sz val=\"11\"/><name val=\"Calibri\"/></font>" +
                "<font><b/><sz val=\"11\"/><name val=\"Calibri\"/></font>" +
                "<font><b/><sz val=\"16\"/><color rgb=\"FF1E3A8A\"/><name val=\"Calibri\"/></font>" +
                "<font><sz val=\"10\"/><color rgb=\"FF64748B\"/><name val=\"Calibri\"/></font>" +
                "</fonts>" +
                "<fills count=\"3\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill>" +
                "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFE0E7FF\"/><bgColor indexed=\"64\"/></patternFill></fill></fills>" +
                "<borders count=\"2\"><border><left/><right/><top/><bottom/><diagonal/></border>" +
                "<border><left/><right/><top/><bottom style=\"thin\"><color rgb=\"FF94A3B8\"/></bottom><diagonal/></border></borders>" +
                "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>" +
                "<cellXfs count=\"5\">" +
                "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>" +
                "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>" +
                "<xf numFmtId=\"0\" fontId=\"2\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>" +
                "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"2\" borderId=\"1\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\" applyBorder=\"1\"/>" +
                "<xf numFmtId=\"0\" fontId=\"3\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>" +
                "</cellXfs>" +
                "<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles>" +
                "</styleSheet>");

            var sb = new StringBuilder();
            sb.Append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
            sb.Append("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">");
            if (_freezeAfterRow > 0)
                sb.Append($"<sheetViews><sheetView workbookViewId=\"0\"><pane ySplit=\"{_freezeAfterRow}\" topLeftCell=\"A{_freezeAfterRow + 1}\" activePane=\"bottomLeft\" state=\"frozen\"/></sheetView></sheetViews>");
            if (_widths.Count > 0)
            {
                sb.Append("<cols>");
                for (var i = 0; i < _widths.Count; i++)
                    sb.Append($"<col min=\"{i + 1}\" max=\"{i + 1}\" width=\"{_widths[i].ToString(System.Globalization.CultureInfo.InvariantCulture)}\" customWidth=\"1\"/>");
                sb.Append("</cols>");
            }
            sb.Append("<sheetData>");
            for (var r = 0; r < _rows.Count; r++)
            {
                var (style, cells) = _rows[r];
                sb.Append($"<row r=\"{r + 1}\">");
                for (var c = 0; c < cells.Length; c++)
                {
                    var v = cells[c];
                    if (v is null) continue;
                    var refName = Col(c) + (r + 1);
                    var s = style == 0 ? "" : $" s=\"{style}\"";
                    if (v is int or long or double or decimal)
                        sb.Append($"<c r=\"{refName}\"{s}><v>{Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture)}</v></c>");
                    else
                        sb.Append($"<c r=\"{refName}\"{s} t=\"inlineStr\"><is><t xml:space=\"preserve\">{Esc(v.ToString() ?? "")}</t></is></c>");
                }
                sb.Append("</row>");
            }
            sb.Append("</sheetData>");
            sb.Append("<pageSetup orientation=\"landscape\"/>");
            sb.Append("</worksheet>");
            Add(zip, "xl/worksheets/sheet1.xml", sb.ToString());
        }
        return ms.ToArray();
    }

    private static string Col(int index)
    {
        var name = "";
        for (var n = index + 1; n > 0; n = (n - 1) / 26) name = (char)('A' + (n - 1) % 26) + name;
        return name;
    }

    // XML-safe text; characters XML can't hold at all are dropped
    private static string Esc(string text) =>
        SecurityElement.Escape(new string(text.Where(ch => ch == '\t' || ch == '\n' || ch == '\r' || ch >= 0x20).ToArray())) ?? "";

    private static void Add(ZipArchive zip, string name, string content)
    {
        var entry = zip.CreateEntry(name, CompressionLevel.Optimal);
        using var w = new StreamWriter(entry.Open(), new UTF8Encoding(false));
        w.Write(content);
    }
}
