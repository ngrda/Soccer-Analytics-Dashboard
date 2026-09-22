#!/usr/bin/env python3
"""
Simple local server for the soccer stats dashboard.

Usage:
    python3 app.py [port]

By default serves the files in the same folder
(index.html, styles.css, script.js) at http://localhost:8000.
"""

import http.server
import socketserver
import sys
import webbrowser
from pathlib import Path

DEFAULT_PORT = 8000


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT

    # Serve files from the folder where this script lives,
    # regardless of where the command is run from.
    root = Path(__file__).resolve().parent

    handler = http.server.SimpleHTTPRequestHandler
    handler.extensions_map.update({".js": "application/javascript"})

    class Handler(handler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)

    with socketserver.TCPServer(("", port), Handler) as httpd:
        url = f"http://localhost:{port}/index.html"
        print(f"Serving the dashboard at {url}")
        print("Press Ctrl+C to stop the server.")
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")


if __name__ == "__main__":
    main()
