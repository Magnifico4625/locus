const REPO_URL = 'https://github.com/Magnifico4625/locus';
const CODEX_INSTALL_COMMAND = 'npx -y locus-memory@latest install codex';

function showToast(message = 'Copied') {
  const toast = document.getElementById('toast');

  if (!toast) {
    return;
  }

  const toastMessage = document.getElementById('toast-message');
  if (toastMessage) {
    toastMessage.textContent = message;
  }

  toast.classList.remove('translate-y-20', 'opacity-0');

  window.setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0');
  }, 2200);
}

async function copyText(value, message) {
  try {
    await navigator.clipboard.writeText(value);
    showToast(message);
    return;
  } catch {
    const textArea = document.createElement('textarea');
    textArea.value = value;
    textArea.setAttribute('readonly', 'true');
    textArea.style.position = 'absolute';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    showToast(message);
  }
}

async function copyRepoUrl() {
  await copyText(REPO_URL, 'Repository URL copied');
}

async function copyInstallCommand() {
  await copyText(CODEX_INSTALL_COMMAND, 'Install command copied');
}

window.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    window.lucide.createIcons();
  }

  const copyButton = document.getElementById('copy-repo-button');

  if (copyButton) {
    copyButton.addEventListener('click', copyRepoUrl);
  }

  const copyInstallButton = document.getElementById('copy-install-button');

  if (copyInstallButton) {
    copyInstallButton.addEventListener('click', copyInstallCommand);
  }
});
