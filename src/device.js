export function currentDevice() {
  const agent = navigator.userAgent;
  if (/iPhone/i.test(agent)) return { deviceName: 'iPhone', deviceType: 'mobile' };
  if (/iPad/i.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return { deviceName: 'iPad', deviceType: 'mobile' };
  if (/Android/i.test(agent)) return { deviceName: 'Celular Android', deviceType: 'mobile' };
  if (/Windows/i.test(agent)) return { deviceName: 'Computador Windows', deviceType: 'desktop' };
  if (/Mac/i.test(agent)) return { deviceName: 'Mac', deviceType: 'desktop' };
  return { deviceName: 'Navegador', deviceType: 'unknown' };
}
