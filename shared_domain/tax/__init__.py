"""Tax domain."""

from shared_domain.tax.constants import DEFAULT_GST_RATE, GST_COMPONENTS
from shared_domain.tax.gst import split_gst

__all__ = ["DEFAULT_GST_RATE", "GST_COMPONENTS", "split_gst"]
