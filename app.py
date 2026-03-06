import http.server
import webbrowser
import threading
import os

PORT = 3000

os.chdir(os.path.dirname(os.path.abspath(__file__)))

handler = http.server.SimpleHTTPRequestHandler
server = http.server.HTTPServer(("localhost", PORT), handler)

print(f"\n  partcraft v0.0.48")
print(f"  http://localhost:{PORT}")
print(f"  Press Ctrl+C to stop\n")

threading.Timer(0.5, lambda: webbrowser.open(f"http://localhost:{PORT}")).start()

try:
    server.serve_forever()
except KeyboardInterrupt:
    print("\n  Stopped.")
    server.server_close()
