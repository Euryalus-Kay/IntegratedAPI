# Authentication

VibeKit provides email + verification code authentication with zero configuration.

## Send Code

```typescript
import { auth } from 'vibekit'

await auth.sendCode('user@example.com')
// In local dev: code printed to terminal
// In production: code emailed to user
```

## Verify Code

```typescript
const { user, token } = await auth.verifyCode('user@example.com', '384729')
```

## Get Current User

```typescript
const user = await auth.getUser(request)
```

## Protect Routes

```typescript
import { protect } from 'vibekit/auth/middleware'

app.get('/dashboard', protect(), (req, res) => {
  // req.user is guaranteed
})
```
