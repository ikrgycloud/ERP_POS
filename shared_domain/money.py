"""Backward-compatible money/GST imports.

New code should prefer:
  - shared_domain.finance.money
  - shared_domain.tax.gst
"""

from shared_domain.finance.money import MONEY_QUANT, money, to_decimal
from shared_domain.tax.gst import split_gst

__all__ = ["MONEY_QUANT", "money", "split_gst", "to_decimal"]
