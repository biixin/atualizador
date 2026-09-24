import webpush from 'web-push';

export function validSubscription(subscription) {
  try {
    const url = new URL(subscription.endpoint);
    const allowed = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com'].includes(url.hostname) || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname);
    return allowed && url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && subscription.endpoint.length < 2048 && Buffer.from(subscription.keys.p256dh, 'base64url').length === 65 && Buffer.from(subscription.keys.auth, 'base64url').length === 16;
  } catch { return false; }
}

export function pushSender(keys, subject = 'mailto:admin@example.com', timeout = 4000) {
  return (subscription, payload) => webpush.sendNotification(subscription, JSON.stringify(payload), {
    TTL: 3600, urgency: 'high', timeout,
    vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
  });
}
