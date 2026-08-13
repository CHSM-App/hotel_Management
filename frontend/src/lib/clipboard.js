// Copying a link has to work on the machines lodges actually use us from —
// reception PCs reaching the app over the LAN on plain http. navigator.clipboard
// only exists in a secure context, so on those machines it is undefined and the
// copy button silently does nothing.
//
// The hidden-textarea + execCommand path is deprecated but is still the only
// thing that works over http, so it stays as the fallback.
export async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or the document wasn't focused — fall through.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  // Off-screen rather than hidden: the selection only works on a rendered node.
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);

  try {
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}
