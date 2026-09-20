#!/usr/bin/env python3
"""
Servidor local simple para el dashboard de estadísticas de soccer.

Uso:
    python3 app.py [puerto]

Por defecto sirve en http://localhost:8000 los archivos que estén
en la misma carpeta (index.html, styles.css, script.js).
"""

import http.server
import socketserver
import sys
import webbrowser
from pathlib import Path

DEFAULT_PORT = 8000


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT

    # Sirve archivos desde la carpeta donde vive este script,
    # sin importar desde dónde se ejecute el comando.
    root = Path(__file__).resolve().parent

    handler = http.server.SimpleHTTPRequestHandler
    handler.extensions_map.update({".js": "application/javascript"})

    class Handler(handler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)

    with socketserver.TCPServer(("", port), Handler) as httpd:
        url = f"http://localhost:{port}/index.html"
        print(f"Sirviendo el dashboard en {url}")
        print("Presiona Ctrl+C para detener el servidor.")
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServidor detenido.")


if __name__ == "__main__":
    main()
