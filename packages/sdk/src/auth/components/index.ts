/**
 * Auth UI components placeholder.
 * [FUTURE] Will provide pre-built React components for login/signup flows.
 */

export function getLoginPageHTML(): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Login</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f5f5f5; }
    .container { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); width: 100%; max-width: 400px; }
    h1 { font-size: 24px; margin-bottom: 8px; color: #1B4F72; }
    p { color: #666; font-size: 14px; margin-bottom: 24px; }
    input { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 16px; margin-bottom: 16px; }
    button { width: 100%; padding: 12px; background: #1B4F72; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; }
    button:hover { background: #154360; }
    .code-input { letter-spacing: 8px; text-align: center; font-size: 24px; }
    .hidden { display: none; }
    .message { padding: 12px; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
    .success { background: #d4edda; color: #155724; }
    .error { background: #f8d7da; color: #721c24; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Welcome</h1>
    <p>Enter your email to sign in or create an account.</p>
    <div id="message" class="message hidden"></div>
    <div id="email-step">
      <input type="email" id="email" placeholder="you@example.com" />
      <button onclick="sendCode()">Send Code</button>
    </div>
    <div id="code-step" class="hidden">
      <input type="text" id="code" class="code-input" placeholder="000000" maxlength="6" />
      <button onclick="verifyCode()">Verify</button>
    </div>
  </div>
  <script>
    async function sendCode() {
      const email = document.getElementById('email').value;
      try {
        const res = await fetch('/api/auth/send-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
        const data = await res.json();
        if (res.ok) {
          document.getElementById('email-step').classList.add('hidden');
          document.getElementById('code-step').classList.remove('hidden');
          showMessage('Check your email for the verification code.', 'success');
        } else {
          showMessage(data.error, 'error');
        }
      } catch (e) { showMessage('Network error', 'error'); }
    }
    async function verifyCode() {
      const email = document.getElementById('email').value;
      const code = document.getElementById('code').value;
      try {
        const res = await fetch('/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) });
        const data = await res.json();
        if (res.ok) {
          window.location.href = '/';
        } else {
          showMessage(data.error, 'error');
        }
      } catch (e) { showMessage('Network error', 'error'); }
    }
    function showMessage(text, type) {
      const el = document.getElementById('message');
      el.textContent = text;
      el.className = 'message ' + type;
      el.classList.remove('hidden');
    }
  </script>
</body>
</html>
  `.trim()
}
