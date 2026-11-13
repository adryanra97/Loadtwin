"""Vercel Python Function entry point: serves the whole LoadTwin API from one function."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from loadtwin.api import app  # noqa: F401 - Vercel looks for a module-level ASGI ``app``
