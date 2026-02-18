from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
import os
from datetime import datetime

def format_bytes(size):
    power = 2**10
    n = 0
    power_labels = {0 : '', 1: 'KB', 2: 'MB', 3: 'GB', 4: 'TB'}
    while size > power:
        size /= power
        n += 1
    return f"{size:.2f} {power_labels[n]}"

def generate_pdf_report(scan_data, output_path):
    """
    Generates a PDF report from the scan results JSON data.
    """
    doc = SimpleDocTemplate(output_path, pagesize=letter)
    elements = []
    styles = getSampleStyleSheet()
    
    summary = scan_data.get("summary", {})
    duplicates = scan_data.get("duplicates", [])

    # Title
    title_style = styles['Title']
    elements.append(Paragraph("Hardlink Manager Scan Report", title_style))
    elements.append(Spacer(1, 0.2 * inch))

    # Summary Section
    elements.append(Paragraph("Scan Summary", styles['Heading2']))
    
    data = [
        ["Scan Path", str(summary.get("scan_path", "N/A"))],
        ["Date", datetime.now().strftime("%Y-%m-%d %H:%M:%S")],
        ["Total Files Scanned", str(summary.get("total_files", "N/A"))],
        ["Before Size", format_bytes(summary.get("before_size", 0))],
        ["Potential Savings", format_bytes(summary.get("potential_savings", 0))],
        ["Duplicate Sets Found", str(summary.get("total_sets_found", 0))],
        ["Space Saved (Actual)", format_bytes(summary.get("space_saved", 0)) if isinstance(summary.get("space_saved"), (int, float)) else str(summary.get("space_saved", "N/A"))]
    ]

    t = Table(data, colWidths=[2*inch, 4*inch])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.lightgrey),
        ('TEXTCOLOR', (0, 0), (0, -1), colors.black),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
        ('GRID', (0, 0), (-1, -1), 1, colors.black)
    ]))
    elements.append(t)
    elements.append(Spacer(1, 0.3 * inch))

    # Duplicates List (Top 50 to avoid massive PDF)
    elements.append(Paragraph(f"Top Duplicate Sets (Showing first {min(len(duplicates), 50)})", styles['Heading2']))
    
    for i, dupe_set in enumerate(duplicates[:50]):
        # dupe_set is [size_string, file1, file2...]
        size_str = dupe_set[0]
        files = dupe_set[1:]
        
        elements.append(Paragraph(f"Set #{i+1} - Size: {size_str}", styles['Heading3']))
        
        file_list = []
        for f in files:
            path = f.get('path', 'Unknown')
            linked_status = "(Already Linked)" if f.get('already_linked') else ""
            file_list.append([Paragraph(f"{path} <font color='blue'>{linked_status}</font>", styles['Normal'])])
            
        ft = Table(file_list, colWidths=[6*inch])
        ft.setStyle(TableStyle([
            ('BOX', (0,0), (-1,-1), 0.25, colors.grey),
            ('LEFTPADDING', (0,0), (-1,-1), 10),
        ]))
        elements.append(ft)
        elements.append(Spacer(1, 0.1 * inch))

    if len(duplicates) > 50:
        elements.append(Paragraph(f"... and {len(duplicates) - 50} more sets.", styles['Normal']))

    doc.build(elements)
    return True
