from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from app.invoice_pdf import PdfBuilder, _clean, _money, wrap_text
from app.models import BusinessProfile, SupplierReturn
from shared_domain.settings import BusinessSettingsService


business_settings_service = BusinessSettingsService()


def _business_lines(db: Session, supplier_return: SupplierReturn) -> list[str]:
    business = (
        db.get(BusinessProfile, supplier_return.business_profile_id)
        if supplier_return.business_profile_id
        else None
    )
    settings = business_settings_service.from_mapping(business)
    return [
        settings.business_name or settings.company_name or "Business",
        settings.address,
        f"GSTIN: {settings.gst_number or '-'}",
        f"PAN: {settings.pan_number or '-'}",
        f"Contact: {settings.phone or '-'}",
        f"Email: {settings.email or '-'}",
    ]


def _supplier_lines(supplier_return: SupplierReturn) -> list[str]:
    supplier = supplier_return.supplier
    snapshot = supplier_return.supplier_snapshot or {}
    return [
        supplier.name if supplier else snapshot.get("name") or "Supplier",
        supplier.address if supplier else snapshot.get("address") or "",
        f"GSTIN: {(supplier.gstin if supplier else snapshot.get('gstin')) or '-'}",
        f"Contact: {(supplier.mobile if supplier else snapshot.get('mobile')) or '-'}",
        f"Email: {(supplier.email if supplier else snapshot.get('email')) or '-'}",
    ]


def _items_total(supplier_return: SupplierReturn) -> Decimal:
    total = Decimal("0")
    for item in supplier_return.items or []:
        total += Decimal(item.quantity_requested or 0) * Decimal(item.unit_cost or 0)
    return total


PAGE_WIDTH = 595
PAGE_HEIGHT = 842
LEFT = 36
RIGHT = 559
CONTENT_WIDTH = RIGHT - LEFT
INK = (0.059, 0.090, 0.165)
MUTED = (0.392, 0.455, 0.545)
BORDER = (0.863, 0.898, 0.949)
PRIMARY = (0.145, 0.388, 0.922)
PRIMARY_SOFT = (0.937, 0.965, 1.0)
ROW_ALT = (0.973, 0.980, 0.992)


def _fill(pdf: PdfBuilder, color: tuple[float, float, float]) -> None:
    pdf.fill_color(*color)


def _stroke(pdf: PdfBuilder, color: tuple[float, float, float]) -> None:
    pdf.stroke_color(*color)


def _page_frame(pdf: PdfBuilder, continuation_label: str | None = None) -> None:
    _fill(pdf, (1, 1, 1))
    _stroke(pdf, BORDER)
    pdf.rect(22, 22, PAGE_WIDTH - 44, PAGE_HEIGHT - 44, stroke=True, fill=True)
    if continuation_label:
        _fill(pdf, PRIMARY)
        pdf.text(LEFT, 798, continuation_label, size=8, bold=True)


def _draw_lines(pdf: PdfBuilder, x: float, top: float, lines: list[str], width: int, size: int = 7, max_lines: int = 2) -> None:
    y = top
    for value in lines:
        for line in wrap_text(value, width, max_lines=max_lines):
            pdf.text(x, y, line, size=size)
            y -= 9


def _draw_header(pdf: PdfBuilder, db: Session, supplier_return: SupplierReturn) -> float:
    top = 804
    height = 120
    _fill(pdf, PRIMARY_SOFT)
    _stroke(pdf, BORDER)
    pdf.rect(LEFT, top - height, CONTENT_WIDTH, height, stroke=True, fill=True)

    _fill(pdf, INK)
    pdf.text(LEFT + 14, top - 24, "RETURN TO VENDOR", size=17, bold=True)
    _fill(pdf, MUTED)
    pdf.text(LEFT + 14, top - 40, "Supplier return and damaged-goods movement document", size=7)
    _draw_lines(pdf, LEFT + 14, top - 62, _business_lines(db, supplier_return), 52, size=6, max_lines=1)

    divider_x = 355
    _stroke(pdf, BORDER)
    pdf.line(divider_x, top - height + 10, divider_x, top - 10)
    meta = [
        ("RTV number", supplier_return.rtv_number),
        ("Created", supplier_return.created_at.date() if supplier_return.created_at else "-"),
        ("Workflow", supplier_return.current_status.code if supplier_return.current_status else supplier_return.shipment_status),
        ("Shipment", supplier_return.shipment_status),
        ("Reference", supplier_return.purchase_order_id or supplier_return.purchase_invoice_id or "-"),
    ]
    y = top - 22
    for label, value in meta:
        _fill(pdf, MUTED)
        pdf.text(divider_x + 14, y, label, size=6)
        _fill(pdf, INK)
        value_lines = wrap_text(str(value or "-"), 26, max_lines=1)
        pdf.text(divider_x + 82, y, value_lines[0] if value_lines else "-", size=6, bold=True)
        y -= 18
    return top - height - 12


def _draw_supplier_card(pdf: PdfBuilder, supplier_return: SupplierReturn, top: float) -> float:
    supplier_lines = _supplier_lines(supplier_return)
    line_count = sum(max(1, len(wrap_text(line, 72, max_lines=2))) for line in supplier_lines if _clean(line))
    height = max(74, 32 + line_count * 9)
    _stroke(pdf, BORDER)
    pdf.rect(LEFT, top - height, CONTENT_WIDTH, height)
    _fill(pdf, PRIMARY)
    pdf.text(LEFT + 12, top - 18, "RETURN TO SUPPLIER", size=7, bold=True)
    _fill(pdf, INK)
    _draw_lines(pdf, LEFT + 12, top - 36, supplier_lines, 72, size=7, max_lines=2)
    return top - height - 14


TABLE_COLUMNS = [
    ("#", 30, "center"),
    ("PRODUCT / SKU", 175, "left"),
    ("REASON", 110, "left"),
    ("QTY", 50, "right"),
    ("UNIT COST", 75, "right"),
    ("AMOUNT", 83, "right"),
]


def _draw_table_header(pdf: PdfBuilder, top: float) -> float:
    height = 26
    _fill(pdf, PRIMARY_SOFT)
    _stroke(pdf, BORDER)
    pdf.rect(LEFT, top - height, CONTENT_WIDTH, height, stroke=True, fill=True)
    x = LEFT
    _fill(pdf, PRIMARY)
    for index, (label, width, align) in enumerate(TABLE_COLUMNS):
        if index:
            _stroke(pdf, BORDER)
            pdf.line(x, top - height, x, top)
        text_width = len(label) * 5 * 0.48
        text_x = x + 5 if align == "left" else x + max(4, (width - text_width) / 2) if align == "center" else x + width - text_width - 5
        pdf.text(text_x, top - 17, label, size=5, bold=True)
        x += width
    return top - height


def _draw_item_row(pdf: PdfBuilder, supplier_return: SupplierReturn, item: object, index: int, top: float) -> float:
    snapshot = item.product_snapshot or {}
    name = snapshot.get("name") or f"Product {item.product_id}"
    sku = snapshot.get("sku") or "-"
    product_lines = wrap_text(name, 33, max_lines=3) + wrap_text(f"SKU: {sku}", 33, max_lines=1)
    reason_lines = wrap_text(item.reason or supplier_return.reason or "Damaged", 19, max_lines=3)
    row_height = max(30, 12 + max(len(product_lines), len(reason_lines)) * 8)
    if index % 2 == 0:
        _fill(pdf, ROW_ALT)
        pdf.rect(LEFT, top - row_height, CONTENT_WIDTH, row_height, stroke=False, fill=True)
    _stroke(pdf, BORDER)
    pdf.line(LEFT, top - row_height, RIGHT, top - row_height, width=0.4)
    boundaries = [LEFT + 30, LEFT + 205, LEFT + 315, LEFT + 365, LEFT + 440]
    for boundary in boundaries:
        pdf.line(boundary, top - row_height, boundary, top, width=0.4)

    qty = Decimal(item.quantity_requested or 0)
    unit_cost = Decimal(item.unit_cost or 0)
    values = [str(index), product_lines, reason_lines, f"{qty:.3f}", _money(unit_cost), _money(qty * unit_cost)]
    x = LEFT
    for column_index, ((_, width, align), value) in enumerate(zip(TABLE_COLUMNS, values)):
        lines = value if isinstance(value, list) else [value]
        for line_index, line in enumerate(lines):
            size = 6 if column_index < 3 else 5
            text_width = len(str(line)) * size * 0.48
            if align == "right":
                text_x = x + width - text_width - 5
            elif align == "center":
                text_x = x + max(4, (width - text_width) / 2)
            else:
                text_x = x + 5
            _fill(pdf, INK if line_index == 0 else MUTED)
            pdf.text(text_x, top - 14 - line_index * 8, line, size=size, bold=column_index == 1 and line_index == 0)
        x += width
    return top - row_height


def _draw_summary(pdf: PdfBuilder, supplier_return: SupplierReturn, top: float) -> float:
    remarks = supplier_return.remarks or supplier_return.reason or "Damaged product return"
    remark_lines = wrap_text(remarks, 55, max_lines=7)
    height = max(92, 42 + len(remark_lines) * 9)
    left_width = 300
    gap = 10
    right_x = LEFT + left_width + gap
    right_width = CONTENT_WIDTH - left_width - gap
    _stroke(pdf, BORDER)
    pdf.rect(LEFT, top - height, left_width, height)
    pdf.rect(right_x, top - height, right_width, height)
    _fill(pdf, PRIMARY)
    pdf.text(LEFT + 12, top - 18, "REMARKS", size=7, bold=True)
    _fill(pdf, INK)
    for index, line in enumerate(remark_lines):
        pdf.text(LEFT + 12, top - 36 - index * 9, line, size=7)
    _fill(pdf, PRIMARY)
    pdf.text(right_x + 12, top - 18, "RETURN SUMMARY", size=7, bold=True)
    summary = [
        ("Items", len(supplier_return.items or [])),
        ("Estimated value", _money(_items_total(supplier_return))),
        ("Shipment", supplier_return.shipment_status or "-"),
    ]
    y = top - 40
    for label, value in summary:
        _fill(pdf, MUTED)
        pdf.text(right_x + 12, y, label, size=6)
        _fill(pdf, INK)
        pdf.text(right_x + 100, y, str(value), size=6, bold=True)
        y -= 17
    return top - height - 14


def _draw_signatures(pdf: PdfBuilder, top: float) -> float:
    height = 78
    _stroke(pdf, BORDER)
    pdf.rect(LEFT, top - height, CONTENT_WIDTH, height)
    _fill(pdf, MUTED)
    pdf.text(LEFT + 12, top - 20, "Authorized signature", size=6)
    pdf.text(LEFT + 324, top - 20, "Supplier acknowledgement", size=6)
    pdf.line(LEFT + 12, top - 52, LEFT + 215, top - 52)
    pdf.line(LEFT + 324, top - 52, RIGHT - 12, top - 52)
    return top - height - 12


def _draw_footers(pdf: PdfBuilder, supplier_return: SupplierReturn) -> None:
    for page_index in range(pdf.page_count):
        pdf.set_page(page_index)
        _fill(pdf, PRIMARY_SOFT)
        _stroke(pdf, BORDER)
        pdf.rect(LEFT, 38, CONTENT_WIDTH, 22, stroke=True, fill=True)
        _fill(pdf, MUTED)
        pdf.text(LEFT + 8, 46, f"RTV {_clean(supplier_return.rtv_number)}", size=6)
        pdf.text(RIGHT - 68, 46, f"Page {page_index + 1} of {pdf.page_count}", size=6)


def build_rtv_pdf(db: Session, supplier_return: SupplierReturn) -> bytes:
    pdf = PdfBuilder()
    _page_frame(pdf)
    y = _draw_header(pdf, db, supplier_return)
    y = _draw_supplier_card(pdf, supplier_return, y)
    y = _draw_table_header(pdf, y)

    for index, item in enumerate(supplier_return.items or [], start=1):
        snapshot = item.product_snapshot or {}
        name_lines = wrap_text(snapshot.get("name") or f"Product {item.product_id}", 33, max_lines=3)
        reason_lines = wrap_text(item.reason or supplier_return.reason or "Damaged", 19, max_lines=3)
        estimated_height = max(30, 12 + max(len(name_lines) + 1, len(reason_lines)) * 8)
        if y - estimated_height < 150:
            pdf.new_page()
            _page_frame(pdf, "RETURN TO VENDOR - ITEM CONTINUATION")
            y = _draw_table_header(pdf, 780)
        y = _draw_item_row(pdf, supplier_return, item, index, y)

    if y < 290:
        pdf.new_page()
        _page_frame(pdf, "RETURN TO VENDOR - SUMMARY")
        y = 760
    y = _draw_summary(pdf, supplier_return, y - 14)
    if y < 145:
        pdf.new_page()
        _page_frame(pdf, "RETURN TO VENDOR - APPROVALS")
        y = 760
    _draw_signatures(pdf, y)
    _draw_footers(pdf, supplier_return)
    return pdf.write_pdf()
