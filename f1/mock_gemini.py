import http.server
import json
import socketserver

PORT = 8001

class MockGeminiHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        # request_body = json.loads(post_data.decode('utf-8'))
        
        response = {
            "candidates": [{
                "content": {
                    "parts": [{
                        "text": json.dumps({
                            "entries": [{
                                "date": "2026-03-18",
                                "type": "mood",
                                "score": -2,
                                "summary": "irritable",
                                "original_text": "she was really irritable"
                            }],
                            "understood": True
                        })
                    }]
                }
            }]
        }
        
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(response).encode('utf-8'))

if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), MockGeminiHandler) as httpd:
        print(f"Mock Gemini API running on port {PORT}")
        httpd.serve_forever()
