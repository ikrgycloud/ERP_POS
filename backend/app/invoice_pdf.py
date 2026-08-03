from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from io import BytesIO
from typing import Iterable, Sequence

from sqlalchemy.orm import Session

from app.models import BusinessProfile, Customer, Invoice, Outlet, Supplier
from app.services import invoice_total


PAGE_WIDTH = 595
PAGE_HEIGHT = 842
MARGIN = 28
CONTENT_WIDTH = PAGE_WIDTH - (MARGIN * 2)

BLUE = (0.145, 0.388, 0.922)
BLUE_DARK = (0.118, 0.227, 0.541)
BLUE_SOFT = (0.937, 0.965, 1.0)
INK = (0.059, 0.090, 0.165)
MUTED = (0.392, 0.455, 0.545)
BORDER = (0.863, 0.898, 0.949)
ROW_ALT = (0.973, 0.980, 0.992)
SUCCESS = (0.086, 0.639, 0.290)
WARNING = (0.961, 0.620, 0.043)
DANGER = (0.863, 0.149, 0.149)


def _money(value: Decimal | int | float | None) -> str:
    amount = Decimal(value or 0)
    return f"Rs. {amount:,.2f}"


def _clean(value: object | None) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text.lower() in {"none", "n/a", "not provided", "not available", "-", "--", "na"}:
        return ""
    return text


def has_value(value: object | None) -> bool:
    return value is not None and _clean(value) != ""


def valid_text(value: object | None) -> str:
    return _clean(value)


def _positive(value: object | None) -> bool:
    try:
        return Decimal(value or 0) != 0
    except (ValueError, TypeError):
        return False


def _escape_pdf_text(value: object | None) -> str:
    text = _clean(value).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    return text.encode("latin-1", "replace").decode("latin-1")


def _short(value: object | None, limit: int) -> str:
    text = _clean(value)
    return text if len(text) <= limit else f"{text[: max(0, limit - 3)]}..."


def wrap_text(value: object | None, limit: int, max_lines: int | None = None) -> list[str]:
    words = _clean(value).split()
    if not words:
        return []
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and len(candidate) > limit:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    if max_lines and len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = _short(lines[-1], max(4, limit - 1))
    return lines


def _amount_in_words(value: Decimal | int | float | None) -> str:
    amount = int(Decimal(value or 0).quantize(Decimal("1")))
    ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"]
    teens = ["Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
    tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

    def under_hundred(number: int) -> str:
        if number < 10:
            return ones[number]
        if number < 20:
            return teens[number - 10]
        return f"{tens[number // 10]} {ones[number % 10]}".strip()

    def under_thousand(number: int) -> str:
        result: list[str] = []
        if number >= 100:
            result.append(f"{ones[number // 100]} Hundred")
        if number % 100:
            result.append(under_hundred(number % 100))
        return " ".join(result)

    if amount == 0:
        return "Zero Rupees Only"
    result: list[str] = []
    for divisor, label in ((10_000_000, "Crore"), (100_000, "Lakh"), (1_000, "Thousand")):
        group, amount = divmod(amount, divisor)
        if group:
            result.append(f"{under_thousand(group)} {label}")
    if amount:
        result.append(under_thousand(amount))
    return f"{' '.join(result)} Rupees Only"


class PdfBuilder:
    def __init__(self, page_width: float = PAGE_WIDTH, page_height: float = PAGE_HEIGHT) -> None:
        self.pages: list[list[str]] = [[]]
        self._page_index = 0
        self.page_width = page_width
        self.page_height = page_height

    @property
    def commands(self) -> list[str]:
        return self.pages[self._page_index]

    @property
    def page_count(self) -> int:
        return len(self.pages)

    def new_page(self) -> int:
        self.pages.append([])
        self._page_index = len(self.pages) - 1
        return self._page_index

    def set_page(self, index: int) -> None:
        self._page_index = index

    def text(self, x: float, y: float, value: object | None, size: int = 9, bold: bool = False) -> None:
        if not has_value(value):
            return
        font = "F2" if bold else "F1"
        self.commands.append(f"BT /{font} {size} Tf {x:.2f} {y:.2f} Td ({_escape_pdf_text(value)}) Tj ET")

    def line(self, x1: float, y1: float, x2: float, y2: float, width: float = 0.6) -> None:
        self.commands.append(f"{width:.2f} w {x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S")

    def rect(self, x: float, y: float, width: float, height: float, stroke: bool = True, fill: bool = False) -> None:
        operator = "B" if stroke and fill else "S" if stroke else "f"
        self.commands.append(f"{x:.2f} {y:.2f} {width:.2f} {height:.2f} re {operator}")

    def fill_color(self, r: float, g: float, b: float) -> None:
        self.commands.append(f"{r:.3f} {g:.3f} {b:.3f} rg")

    def stroke_color(self, r: float, g: float, b: float) -> None:
        self.commands.append(f"{r:.3f} {g:.3f} {b:.3f} RG")

    def black(self) -> None:
        self.fill_color(0, 0, 0)
        self.stroke_color(0, 0, 0)

    def write_pdf(self) -> bytes:
        page_count = len(self.pages)
        page_refs = list(range(3, 3 + page_count))
        font_regular_ref = 3 + page_count
        font_bold_ref = font_regular_ref + 1
        content_refs = list(range(font_bold_ref + 1, font_bold_ref + 1 + page_count))
        objects: list[bytes] = [
            b"<< /Type /Catalog /Pages 2 0 R >>",
            f"<< /Type /Pages /Kids [{' '.join(f'{ref} 0 R' for ref in page_refs)}] /Count {page_count} >>".encode(),
        ]
        for content_ref in content_refs:
            objects.append(
                (
                    f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {self.page_width} {self.page_height}] "
                    f"/Resources << /Font << /F1 {font_regular_ref} 0 R /F2 {font_bold_ref} 0 R >> >> "
                    f"/Contents {content_ref} 0 R >>"
                ).encode()
            )
        objects.extend(
            [
                b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
                b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
            ]
        )
        for commands in self.pages:
            stream = "\n".join(commands).encode("latin-1", "replace")
            objects.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")

        output = BytesIO()
        output.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = [0]
        for index, pdf_object in enumerate(objects, start=1):
            offsets.append(output.tell())
            output.write(f"{index} 0 obj\n".encode())
            output.write(pdf_object)
            output.write(b"\nendobj\n")
        xref_start = output.tell()
        output.write(f"xref\n0 {len(objects) + 1}\n".encode())
        output.write(b"0000000000 65535 f \n")
        for offset in offsets[1:]:
            output.write(f"{offset:010d} 00000 n \n".encode())
        output.write(f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_start}\n%%EOF".encode())
        return output.getvalue()


def _draw_multiline(
    pdf: PdfBuilder,
    x: float,
    y: float,
    lines: list[object],
    size: int = 8,
    line_height: float = 14,
    max_lines: int | None = None,
) -> float:
    visible = lines if max_lines is None else lines[:max_lines]
    for index, line in enumerate(visible):
        pdf.text(x, y - (index * line_height), line, size=size)
    return y - (len(visible) * line_height)


def _set_fill(pdf: PdfBuilder, color: tuple[float, float, float]) -> None:
    pdf.fill_color(*color)


def _set_stroke(pdf: PdfBuilder, color: tuple[float, float, float]) -> None:
    pdf.stroke_color(*color)


def _draw_card(pdf: PdfBuilder, x: float, y: float, width: float, height: float, fill: tuple[float, float, float] | None = None) -> None:
    _set_stroke(pdf, BORDER)
    if fill:
        _set_fill(pdf, fill)
        pdf.rect(x, y, width, height, stroke=True, fill=True)
    else:
        pdf.rect(x, y, width, height)


def draw_demo_upi_qr(pdf: PdfBuilder, x: float, y: float, size: float, invoice: Invoice) -> None:
    """Draw a harmless, scannable placeholder QR directly into the PDF."""
    payload = f"DEMO UPI QR - NOT FOR PAYMENT | Invoice {invoice.invoice_number or invoice.id}"
    try:
        import qrcode

        qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=1, box_size=1)
        qr.add_data(payload)
        qr.make(fit=True)
        matrix = qr.get_matrix()
    except ModuleNotFoundError:
        import hashlib

        digest = hashlib.sha256(payload.encode("utf-8")).digest()
        matrix_size = 29
        matrix = []
        for row_index in range(matrix_size):
            row = []
            for column_index in range(matrix_size):
                in_finder = (
                    row_index < 7 and column_index < 7
                    or row_index < 7 and column_index >= matrix_size - 7
                    or row_index >= matrix_size - 7 and column_index < 7
                )
                digest_index = (row_index * matrix_size + column_index) % len(digest)
                row.append(in_finder or bool(digest[digest_index] & (1 << (column_index % 8))))
            matrix.append(row)
    module_size = size / len(matrix)

    _set_fill(pdf, (1, 1, 1))
    pdf.rect(x, y, size, size, stroke=False, fill=True)
    _set_fill(pdf, INK)
    for row_index, row in enumerate(matrix):
        for column_index, enabled in enumerate(row):
            if enabled:
                pdf.rect(
                    x + column_index * module_size,
                    y + (len(matrix) - row_index - 1) * module_size,
                    module_size + 0.02,
                    module_size + 0.02,
                    stroke=False,
                    fill=True,
                )


def clean_optional_rows(rows: Iterable[tuple[str, object | None]]) -> list[tuple[str, str]]:
    return [(label, _clean(value)) for label, value in rows if has_value(value)]


def measure_text_height(text: object | None, width: int, line_height: int = 8) -> int:
    return max(12, len(wrap_text(text, width, max_lines=8)) * line_height)


def calculate_section_height(rows: Sequence[tuple[str, str]], width: float, title_space: float = 24) -> float:
    content_height = 0.0
    for _, value in rows:
        line_count = max(1, len(wrap_text(value, max(10, int((width - 18) / 3.4)), max_lines=3)))
        content_height += max(13, line_count * 8 + 4)
    return max(60, title_space + content_height + 10)


def draw_dynamic_card(pdf: PdfBuilder, x: float, top: float, width: float, height: float, title: str, rows: Sequence[tuple[str, str]]) -> None:
    _draw_card(pdf, x, top - height, width, height)
    _set_fill(pdf, BLUE_DARK)
    pdf.text(x + 10, top - 16, title, size=7, bold=True)
    y = top - 32
    for label, value in rows:
        value_lines = wrap_text(value, max(10, int((width - 22) / 3.4)), max_lines=3)
        if not value_lines:
            continue
        _set_fill(pdf, MUTED)
        pdf.text(x + 10, y, label, size=6)
        _set_fill(pdf, INK)
        for index, line in enumerate(value_lines):
            pdf.text(x + 72, y - (index * 8), line, size=6, bold=True)
        y -= max(13, len(value_lines) * 8 + 4)


def draw_label_value_rows(pdf: PdfBuilder, x: float, top: float, width: float, rows: Sequence[tuple[str, str]], label_width: float | None = None) -> float:
    label_width = label_width or width * 0.42
    y = top
    for label, value in rows:
        value_lines = wrap_text(value, max(12, int((width - label_width) / 3.6)), max_lines=3)
        row_height = max(13, len(value_lines) * 8 + 4)
        _set_fill(pdf, MUTED)
        pdf.text(x, y, label, size=6)
        _set_fill(pdf, INK)
        for line_index, line in enumerate(value_lines):
            pdf.text(x + label_width, y - (line_index * 8), line, size=6, bold=True)
        y -= row_height
    return y


def _seller_entity(db: Session, invoice: Invoice) -> BusinessProfile | Outlet | None:
    business = db.get(BusinessProfile, invoice.business_profile_id) if invoice.business_profile_id else None
    if invoice.invoice_direction == "outlet_to_customer" and invoice.outlet_id:
        return db.get(Outlet, invoice.outlet_id) or business
    return business


def _buyer_entity(db: Session, invoice: Invoice) -> Customer | Outlet | Supplier | None:
    if invoice.customer_id:
        return db.get(Customer, invoice.customer_id)
    if invoice.outlet_id and invoice.invoice_direction != "outlet_to_customer":
        return db.get(Outlet, invoice.outlet_id)
    if invoice.order and invoice.order.supplier_id:
        return db.get(Supplier, invoice.order.supplier_id)
    return None


def _draw_page_frame(pdf: PdfBuilder, continuation_label: str | None = None) -> None:
    _set_fill(pdf, (1, 1, 1))
    _set_stroke(pdf, BORDER)
    pdf.rect(20, 20, PAGE_WIDTH - 40, PAGE_HEIGHT - 40, stroke=True, fill=True)
    if continuation_label:
        _set_fill(pdf, BLUE_DARK)
        pdf.text(MARGIN, 805, continuation_label, size=8, bold=True)


def draw_company_header(pdf: PdfBuilder, invoice: Invoice, seller: object | None, payment_summary: object | None = None) -> float:
    seller_name = getattr(seller, "trade_name", None) or getattr(seller, "legal_name", None) or getattr(seller, "name", None)
    legal_name = getattr(seller, "legal_name", None)
    address = getattr(seller, "billing_address", None) or getattr(seller, "address", None)
    location = ", ".join(
        valid_text(value)
        for value in (getattr(seller, "city", None), getattr(seller, "state", None), getattr(seller, "pincode", None))
        if has_value(value)
    )
    left_lines = [value for value in (seller_name, legal_name if legal_name != seller_name else None, address, location) if has_value(value)]
    contact_lines = [
        f"Phone: {getattr(seller, 'mobile', None)}" if has_value(getattr(seller, "mobile", None)) else None,
        f"Email: {getattr(seller, 'email', None)}" if has_value(getattr(seller, "email", None)) else None,
        f"Website: {getattr(seller, 'website', None)}" if has_value(getattr(seller, "website", None)) else None,
        f"GSTIN: {getattr(seller, 'gstin', None)}" if has_value(getattr(seller, "gstin", None)) else None,
        f"PAN: {getattr(seller, 'pan', None)}" if has_value(getattr(seller, "pan", None)) else None,
    ]
    left_width = 205
    center_width = 150
    right_width = 155
    header_height = 112
    top = 803
    _set_fill(pdf, BLUE_SOFT)
    _set_stroke(pdf, BORDER)
    pdf.rect(MARGIN, top - header_height, CONTENT_WIDTH, header_height, stroke=True, fill=True)

    initials = getattr(seller, "logo_text", None) or (_clean(seller_name)[:3].upper() if seller_name else "")
    if initials:
        _set_fill(pdf, BLUE)
        pdf.rect(MARGIN + 10, top - 36, 36, 28, stroke=False, fill=True)
        _set_fill(pdf, (1, 1, 1))
        pdf.text(MARGIN + 20, top - 24, _short(initials, 4), size=8, bold=True)
        name_x = MARGIN + 56
    else:
        name_x = MARGIN + 10
    _set_fill(pdf, INK)
    pdf.text(name_x, top - 18, seller_name, size=9, bold=True)
    y = top - 36
    _set_fill(pdf, MUTED)
    for line in left_lines[1:]:
        for wrapped in wrap_text(line, 34, max_lines=2):
            pdf.text(name_x, y, wrapped, size=6)
            y -= 8
    for line in [line for line in contact_lines if line]:
        pdf.text(name_x, y, _short(line, 42), size=6)
        y -= 8

    center_x = MARGIN + left_width + 8
    title = "CREDIT NOTE" if invoice.is_reverse else "TAX INVOICE"
    copy = "REVERSE / CREDIT COPY" if invoice.is_reverse else "ORIGINAL FOR RECIPIENT"
    _set_fill(pdf, INK)
    pdf.text(center_x + 20, top - 32, title, size=16, bold=True)
    _set_fill(pdf, BLUE)
    pdf.rect(center_x + 18, top - 58, center_width - 30, 18, stroke=False, fill=True)
    _set_fill(pdf, (1, 1, 1))
    pdf.text(center_x + 24, top - 52, copy, size=6, bold=True)

    right_x = MARGIN + left_width + center_width + 12
    meta_rows = clean_optional_rows(
        [
            ("Invoice No.", invoice.invoice_number),
            ("Invoice Date", invoice.date),
            ("Due Date", invoice.due_date),
            ("Place of Supply", getattr(invoice, "place_of_supply", None) or getattr(seller, "state", None)),
            ("Invoice Type", invoice.invoice_type),
            ("Payment Status", getattr(payment_summary, "payment_status", None) or getattr(invoice, "payment_status", None) or "Unpaid"),
        ]
    )
    _set_fill(pdf, INK)
    y = top - 20
    for index, (label, value) in enumerate(meta_rows):
        if label == "Invoice No.":
            _set_fill(pdf, BLUE)
            pdf.text(right_x, y, valid_text(value), size=8, bold=True)
        else:
            _set_fill(pdf, MUTED)
            pdf.text(right_x, y, f"{label}: {value}", size=6)
        y -= 10
    return top - header_height - 8


def draw_customer_cards(pdf: PdfBuilder, top: float, invoice: Invoice, seller: object | None, buyer: object | None) -> float:
    buyer_name = getattr(buyer, "name", None) or getattr(buyer, "trade_name", None) or getattr(buyer, "legal_name", None) or invoice.party_name
    billed_rows = clean_optional_rows(
        [
            ("Customer", buyer_name),
            ("Customer code", getattr(buyer, "customer_code", None) or getattr(buyer, "outlet_code", None)),
            ("Customer type", invoice.party_type),
            ("Phone", getattr(buyer, "phone", None) or getattr(buyer, "mobile", None)),
            ("Email", getattr(buyer, "email", None)),
            ("GSTIN", getattr(buyer, "gstin", None)),
            ("Address", getattr(buyer, "address", None)),
            ("City", getattr(buyer, "city", None)),
            ("State", getattr(buyer, "state", None)),
            ("PIN", getattr(buyer, "pincode", None)),
        ]
    )
    shipping_rows = clean_optional_rows(
        [
            ("Contact", getattr(invoice, "shipping_contact", None)),
            ("Phone", getattr(invoice, "shipping_phone", None)),
            ("Address", getattr(invoice, "shipping_address", None)),
            ("City", getattr(invoice, "shipping_city", None)),
            ("State", getattr(invoice, "shipping_state", None)),
            ("PIN", getattr(invoice, "shipping_pincode", None)),
            ("Country", getattr(invoice, "shipping_country", None)),
        ]
    )
    order = invoice.order
    details_rows = clean_optional_rows(
        [
            ("Order number", order.order_number if order else None),
            ("Order date", order.date if order else None),
            ("Sales person", getattr(invoice, "sales_person", None)),
            ("Payment terms", getattr(invoice, "payment_terms", None)),
            ("Payment mode", getattr(invoice, "payment_method", None)),
            ("Currency", getattr(seller, "currency", None)),
            ("Warehouse", getattr(invoice, "warehouse", None)),
            ("Branch", getattr(invoice, "branch", None)),
            ("Created by", getattr(invoice, "created_by", None)),
            ("Quotation", getattr(invoice, "quotation_number", None)),
            ("Delivery challan", getattr(invoice, "delivery_challan", None)),
        ]
    )
    cards = [("BILLED TO", billed_rows), ("SHIPPED TO", shipping_rows), ("OTHER DETAILS", details_rows)]
    cards = [(title, rows) for title, rows in cards if rows]
    if not cards:
        return top
    gap = 8
    width = (CONTENT_WIDTH - (gap * (len(cards) - 1))) / len(cards)
    height = max(calculate_section_height(rows, width) for _, rows in cards)
    for index, (title, rows) in enumerate(cards):
        draw_dynamic_card(pdf, MARGIN + index * (width + gap), top, width, height, title, rows)
    return top - height - 10


def _item_metadata(item: object) -> list[str]:
    product = getattr(item, "product", None)
    values = [
        f"SKU: {product.sku}" if has_value(getattr(product, "sku", None)) else None,
        f"Model: {getattr(product, 'model', None)}" if has_value(getattr(product, "model", None)) else None,
        f"Batch: {getattr(item, 'batch_number', None)}" if has_value(getattr(item, "batch_number", None)) else None,
        f"Serial: {getattr(item, 'serial_number', None)}" if has_value(getattr(item, "serial_number", None)) else None,
    ]
    return [value for value in values if value]


def calculate_dynamic_columns(invoice: Invoice, items: Sequence[object]) -> list[dict]:
    has_hsn = any(has_value(getattr(getattr(item, "product", None), "hsn_code", None)) for item in items)
    has_discount = any(_positive(getattr(item, "discount", None)) for item in items)
    columns = [
        {"key": "index", "label": "#", "weight": 0.35, "align": "center"},
        {"key": "item", "label": "ITEM & DESCRIPTION", "weight": 2.35, "align": "left"},
    ]
    if has_hsn:
        columns.append({"key": "hsn", "label": "HSN / SAC", "weight": 0.75, "align": "center"})
    columns.extend(
        [
            {"key": "qty", "label": "QTY", "weight": 0.55, "align": "center"},
            {"key": "unit", "label": "UNIT", "weight": 0.6, "align": "center"},
            {"key": "rate", "label": "UNIT PRICE", "weight": 0.9, "align": "right"},
        ]
    )
    if has_discount:
        columns.append({"key": "discount", "label": "DISCOUNT", "weight": 0.75, "align": "right"})
    columns.append({"key": "taxable", "label": "TAXABLE VALUE", "weight": 1.0, "align": "right"})
    if _positive(invoice.cgst):
        columns.append({"key": "cgst", "label": "CGST", "weight": 0.82, "align": "right"})
    if _positive(invoice.sgst):
        columns.append({"key": "sgst", "label": "SGST", "weight": 0.82, "align": "right"})
    if _positive(invoice.igst):
        columns.append({"key": "igst", "label": "IGST", "weight": 0.82, "align": "right"})
    columns.append({"key": "total", "label": "TOTAL", "weight": 1.0, "align": "right"})
    total_weight = sum(column["weight"] for column in columns)
    x = MARGIN
    for column in columns:
        column["width"] = CONTENT_WIDTH * column["weight"] / total_weight
        column["x"] = x
        x += column["width"]
    return columns


def _item_values(invoice: Invoice, item: object, index: int) -> dict[str, str | list[str]]:
    product = getattr(item, "product", None)
    quantity = Decimal(getattr(item, "quantity", 0) or 0)
    rate = Decimal(getattr(item, "rate", 0) or 0)
    discount = Decimal(getattr(item, "discount", 0) or 0)
    taxable = max(Decimal("0"), (quantity * rate) - discount)
    tax_rate = Decimal(getattr(item, "gst_rate", 0) or 0)
    total_tax = taxable * tax_rate / Decimal("100")
    invoice_tax = Decimal(invoice.cgst or 0) + Decimal(invoice.sgst or 0) + Decimal(invoice.igst or 0)
    cgst = total_tax / 2 if _positive(invoice.cgst) and _positive(invoice.sgst) else total_tax if _positive(invoice.cgst) else Decimal("0")
    sgst = total_tax / 2 if _positive(invoice.cgst) and _positive(invoice.sgst) else total_tax if _positive(invoice.sgst) else Decimal("0")
    igst = total_tax if _positive(invoice.igst) else Decimal("0")
    name = getattr(product, "name", None) or f"Product {getattr(item, 'product_id', '')}".strip()
    item_lines = wrap_text(name, 30, max_lines=4) + _item_metadata(item)
    return {
        "index": str(index),
        "item": item_lines,
        "hsn": _clean(getattr(product, "hsn_code", None)),
        "qty": _clean(quantity.normalize()),
        "unit": _clean(getattr(item, "unit_label", None) or getattr(item, "unit_type", None)),
        "rate": _money(rate),
        "discount": _money(discount),
        "taxable": _money(taxable),
        "cgst": f"{_money(cgst)}\n({tax_rate / 2:.1f}%)",
        "sgst": f"{_money(sgst)}\n({tax_rate / 2:.1f}%)",
        "igst": f"{_money(igst)}\n({tax_rate:.1f}%)",
        "total": _money(taxable + total_tax if invoice_tax else taxable),
    }


def draw_item_table(pdf: PdfBuilder, invoice: Invoice, start_top: float) -> float:
    items = list(invoice.order.items if invoice.order else [])
    if not items:
        return start_top - 20
    columns = calculate_dynamic_columns(invoice, items)
    header_height = 24
    top_of_table = start_top
    row_cursor = top_of_table - header_height - 4
    current_page = 0
    item_start = 0
    while item_start < len(items):
        if current_page > 0:
            pdf.new_page()
            _draw_page_frame(pdf, "TAX INVOICE - ITEM CONTINUATION" if not invoice.is_reverse else "CREDIT NOTE - ITEM CONTINUATION")
            top_of_table = 790
            row_cursor = top_of_table - header_height - 4
        _set_fill(pdf, BLUE_SOFT)
        _set_stroke(pdf, BORDER)
        pdf.rect(MARGIN, top_of_table - header_height, CONTENT_WIDTH, header_height, stroke=True, fill=True)
        _set_fill(pdf, BLUE)
        for index, column in enumerate(columns):
            if index:
                _set_stroke(pdf, BORDER)
                pdf.line(column["x"], top_of_table - header_height, column["x"], top_of_table)
            pdf.text(column["x"] + 4, top_of_table - 16, column["label"], size=5, bold=True)
        rows_per_page = 8
        for offset in range(rows_per_page):
            item_index = item_start + offset
            if item_index >= len(items):
                break
            values = _item_values(invoice, items[item_index], item_index + 1)
            row_height = max(28, len(values.get("item") or []) * 8 + 10)
            if row_cursor - row_height < 70:
                break
            if item_index % 2 == 0:
                _set_fill(pdf, ROW_ALT)
                pdf.rect(MARGIN, row_cursor - row_height, CONTENT_WIDTH, row_height, stroke=False, fill=True)
            _set_stroke(pdf, BORDER)
            pdf.line(MARGIN, row_cursor - row_height, MARGIN + CONTENT_WIDTH, row_cursor - row_height, width=0.4)
            for column_index, column in enumerate(columns):
                if column_index:
                    pdf.line(column["x"], row_cursor - row_height, column["x"], row_cursor, width=0.4)
                raw_value = values.get(column["key"], "")
                lines = raw_value if isinstance(raw_value, list) else _clean(raw_value).splitlines()
                for line_index, line in enumerate(lines):
                    _set_fill(pdf, INK if line_index == 0 else MUTED)
                    size = 6 if line_index == 0 else 5
                    bold = column["key"] in {"item", "total"} and line_index == 0
                    text_width = len(line) * size * 0.48
                    if column["align"] == "right":
                        x = column["x"] + column["width"] - text_width - 4
                    elif column["align"] == "center":
                        x = column["x"] + max(3, (column["width"] - text_width) / 2)
                    else:
                        x = column["x"] + 4
                    pdf.text(x, row_cursor - 14 - (line_index * 8), line, size=size, bold=bold)
            row_cursor -= row_height + 2
        item_start += rows_per_page
        current_page += 1
    return row_cursor - 10


def configured_terms(seller: object | None) -> list[str]:
    raw = getattr(seller, "terms_conditions", None)
    if not has_value(raw):
        raw = getattr(seller, "refund_policy", None)
    return [_clean(line) for line in _clean(raw).splitlines() if has_value(line)]


def actual_payment_rows(invoice: Invoice, payment_summary: object | None = None) -> list[tuple[str, str]]:
    paid_value = getattr(payment_summary, "paid_amount", None)
    remaining_value = getattr(payment_summary, "remaining_amount", None)
    rows: list[tuple[str, object | None]] = []
    if paid_value is not None:
        rows.append(("Paid amount", _money(paid_value)))
    if remaining_value is not None:
        rows.append(("Remaining balance", "Fully Paid" if Decimal(remaining_value) == 0 else _money(remaining_value)))
    rows.extend(
        [
            ("Credit used", _money(getattr(invoice, "credit_used", None)) if _positive(getattr(invoice, "credit_used", None)) else None),
            ("Advance paid", _money(getattr(invoice, "advance_paid", None)) if _positive(getattr(invoice, "advance_paid", None)) else None),
            ("Payment status", getattr(payment_summary, "payment_status", None)),
        ]
    )
    return clean_optional_rows(rows)


def draw_amount_words(pdf: PdfBuilder, invoice: Invoice, start_top: float) -> float:
    words = _amount_in_words(invoice_total(invoice))
    lines = wrap_text(words, 78, max_lines=2)
    height = 48 + max(0, len(lines) - 1) * 8
    _draw_card(pdf, MARGIN, start_top - height, CONTENT_WIDTH - 300 - 8, height, fill=BLUE_SOFT)
    _set_fill(pdf, BLUE_DARK)
    pdf.text(MARGIN + 10, start_top - 16, "AMOUNT IN WORDS", size=7, bold=True)
    _set_fill(pdf, INK)
    for index, line in enumerate(lines):
        pdf.text(MARGIN + 10, start_top - 32 - (index * 8), line, size=7, bold=True)
    return start_top - height - 10


def draw_summary_sections(pdf: PdfBuilder, invoice: Invoice, seller: object | None, start_top: float, payment_summary: object | None = None) -> float:
    totals_rows: list[tuple[str, str]] = []
    if _positive(invoice.taxable_value):
        totals_rows.append(("Subtotal", _money(invoice.taxable_value)))
    if _positive(getattr(invoice, "discount", None)):
        totals_rows.append(("Discount", _money(getattr(invoice, "discount", None))))
    if _positive(invoice.taxable_value):
        totals_rows.append(("Taxable amount", _money(invoice.taxable_value)))
    for label, value in (("CGST", invoice.cgst), ("SGST", invoice.sgst), ("IGST", invoice.igst)):
        if _positive(value):
            totals_rows.append((label, _money(value)))
    for label, name in (("CESS", "cess"), ("Shipping", "shipping"), ("Round off", "round_off")):
        value = getattr(invoice, name, None)
        if _positive(value):
            totals_rows.append((label, _money(value)))
    totals_rows.append(("Grand total", _money(invoice_total(invoice))))

    total_height = 28 + len(totals_rows) * 12
    _draw_card(pdf, MARGIN + 300, start_top - total_height, CONTENT_WIDTH - 300 - 8, total_height)
    _set_fill(pdf, BLUE_DARK)
    pdf.text(MARGIN + 310, start_top - 18, "INVOICE TOTALS", size=7, bold=True)
    y = start_top - 34
    for index, (label, value) in enumerate(totals_rows):
        is_grand = label == "Grand total"
        if is_grand:
            _set_fill(pdf, BLUE_SOFT)
            pdf.rect(MARGIN + 300, y - 8, CONTENT_WIDTH - 300 - 8, 16, stroke=False, fill=True)
        _set_fill(pdf, BLUE if is_grand else MUTED)
        pdf.text(MARGIN + 312, y, label, size=7 if is_grand else 6, bold=is_grand)
        _set_fill(pdf, BLUE if is_grand else INK)
        pdf.text(MARGIN + CONTENT_WIDTH - 80, y, value, size=7 if is_grand else 6, bold=True)
        y -= 12
    start_top -= total_height + 8

    payment_rows = actual_payment_rows(invoice, payment_summary)
    if payment_rows:
        payment_height = 28 + len(payment_rows) * 12
        _draw_card(pdf, MARGIN + 300, start_top - payment_height, CONTENT_WIDTH - 300 - 8, payment_height)
        _set_fill(pdf, BLUE_DARK)
        pdf.text(MARGIN + 310, start_top - 18, "PAYMENT SUMMARY", size=7, bold=True)
        y = start_top - 34
        for label, value in payment_rows:
            if label == "Remaining balance":
                _set_fill(pdf, DANGER if _clean(value).lower() != "fully paid" else SUCCESS)
            elif label == "Paid amount":
                _set_fill(pdf, SUCCESS)
            else:
                _set_fill(pdf, MUTED)
            pdf.text(MARGIN + 312, y, f"{label}: {value}", size=6)
            y -= 12
        start_top -= payment_height + 8

    bank_fields = [
        getattr(seller, "bank_name", None),
        getattr(seller, "account_number", None),
        getattr(seller, "ifsc", None),
        getattr(seller, "bank_branch", None),
        getattr(seller, "swift", None),
        getattr(seller, "upi_id", None),
    ]
    bank_rows = clean_optional_rows(
        [
            ("Bank name", getattr(seller, "bank_name", None)),
            ("Account name", getattr(seller, "account_name", None) or (getattr(seller, "legal_name", None) if any(has_value(value) for value in bank_fields) else None)),
            ("Account number", getattr(seller, "account_number", None)),
            ("IFSC", getattr(seller, "ifsc", None)),
            ("Branch", getattr(seller, "bank_branch", None)),
            ("SWIFT", getattr(seller, "swift", None)),
            ("UPI ID", getattr(seller, "upi_id", None)),
        ]
    )
    if bank_rows and any(has_value(value) for value in bank_fields):
        has_upi = has_value(getattr(seller, "upi_id", None))
        bank_height = max(28 + len(bank_rows) * 10, 112 if has_upi else 0)
        _draw_card(pdf, MARGIN, start_top - bank_height, 260, bank_height)
        _set_fill(pdf, BLUE_DARK)
        pdf.text(MARGIN + 10, start_top - 18, "BANK DETAILS", size=7, bold=True)
        y = start_top - 34
        _set_fill(pdf, MUTED)
        for label, value in bank_rows:
            pdf.text(MARGIN + 10, y, _short(f"{label}: {value}", 39 if has_upi else 55), size=6)
            y -= 10
        if has_upi:
            qr_size = 58
            qr_x = MARGIN + 190
            qr_y = start_top - 78
            draw_demo_upi_qr(pdf, qr_x, qr_y, qr_size, invoice)
            _set_fill(pdf, DANGER)
            pdf.text(qr_x + 3, qr_y - 10, "DEMO UPI QR", size=5, bold=True)
            pdf.text(qr_x, qr_y - 18, "NOT FOR PAYMENT", size=5, bold=True)
        start_top -= bank_height + 8

    terms = configured_terms(seller)
    if terms:
        terms_height = 30 + sum(max(12, len(wrap_text(f"{index}. {term}", 88, max_lines=3)) * 8) for index, term in enumerate(terms, start=1))
        _draw_card(pdf, MARGIN, start_top - terms_height, CONTENT_WIDTH - 300 - 8, terms_height, fill=ROW_ALT)
        _set_fill(pdf, BLUE_DARK)
        pdf.text(MARGIN + 10, start_top - 18, "TERMS & CONDITIONS", size=7, bold=True)
        y = start_top - 34
        _set_fill(pdf, MUTED)
        for index, term in enumerate(terms, start=1):
            lines = wrap_text(f"{index}. {term}", 88, max_lines=3)
            for line in lines:
                pdf.text(MARGIN + 10, y, line, size=6)
                y -= 8
            y -= 4
        start_top -= terms_height + 8

    signature_rows = clean_optional_rows(
        [
            ("Authorized person", getattr(seller, "authorized_person", None)),
            ("Designation", getattr(seller, "designation", None)),
            ("Company", getattr(seller, "company_name", None) or getattr(seller, "trade_name", None) or getattr(seller, "legal_name", None)),
        ]
    )
    if signature_rows:
        sig_height = 52
        _draw_card(pdf, MARGIN + 300, start_top - sig_height, CONTENT_WIDTH - 300 - 8, sig_height)
        _set_fill(pdf, BLUE_DARK)
        pdf.text(MARGIN + 310, start_top - 18, "AUTHORIZED SIGNATORY", size=7, bold=True)
        _set_fill(pdf, MUTED)
        y = start_top - 34
        for label, value in signature_rows:
            pdf.text(MARGIN + 312, y, f"{label}: {value}", size=6)
            y -= 10
        start_top -= sig_height + 8
    return start_top


def draw_page_footer(pdf: PdfBuilder, invoice: Invoice) -> None:
    generated = invoice.created_at if has_value(getattr(invoice, "created_at", None)) else datetime.now()
    for page_index in range(pdf.page_count):
        pdf.set_page(page_index)
        _set_fill(pdf, BLUE_SOFT)
        _set_stroke(pdf, BORDER)
        pdf.rect(MARGIN, 38, CONTENT_WIDTH, 24, stroke=True, fill=True)
        _set_fill(pdf, MUTED)
        pdf.text(MARGIN + 8, 47, f"Generated: {generated}", size=6)
        _set_fill(pdf, BLUE_DARK)
        pdf.text(210, 47, "Computer Generated Invoice - No Signature Required", size=6, bold=True)
        _set_fill(pdf, MUTED)
        pdf.text(PAGE_WIDTH - MARGIN - 60, 47, f"Page {page_index + 1} of {pdf.page_count}", size=6)


def build_invoice_pdf(db: Session, invoice: Invoice) -> bytes:
    from app.invoice_payment_service import calculate_payment_summary

    try:
        payment_summary = calculate_payment_summary(db, invoice)
    except AttributeError:
        paid = getattr(invoice, "paid_amount", None)
        remaining = getattr(invoice, "remaining_amount", None)
        payment_summary = (
            type("PaymentSummary", (), {"paid_amount": paid, "remaining_amount": remaining, "payment_status": getattr(invoice, "payment_status", None)})()
            if paid is not None or remaining is not None
            else None
        )
    pdf = PdfBuilder()
    seller = _seller_entity(db, invoice)
    buyer = _buyer_entity(db, invoice)
    _draw_page_frame(pdf)
    draw_company_header(pdf, invoice, seller, payment_summary)
    y = 690
    y = draw_customer_cards(pdf, y, invoice, seller, buyer)
    y = draw_item_table(pdf, invoice, y)
    if y < 150:
        pdf.new_page()
        _draw_page_frame(pdf, "TAX INVOICE - SUMMARY" if not invoice.is_reverse else "CREDIT NOTE - SUMMARY")
        y = 770
    y = draw_amount_words(pdf, invoice, y)
    y = draw_summary_sections(pdf, invoice, seller, y, payment_summary)
    draw_page_footer(pdf, invoice)
    return pdf.write_pdf()
