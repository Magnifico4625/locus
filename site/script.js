const REPO_URL = 'https://github.com/Magnifico4625/locus';

function showToast() {
  const toast = document.getElementById('toast');

  if (!toast) {
    return;
  }

  toast.classList.remove('translate-y-20', 'opacity-0');

  window.setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0');
  }, 2200);
}

async function copyRepoUrl() {
  try {
    await navigator.clipboard.writeText(REPO_URL);
    showToast();
    return;
  } catch {
    const textArea = document.createElement('textarea');
    textArea.value = REPO_URL;
    textArea.setAttribute('readonly', 'true');
    textArea.style.position = 'absolute';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    showToast();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    window.lucide.createIcons();
  }

  const copyButton = document.getElementById('copy-repo-button');

  if (copyButton) {
    copyButton.addEventListener('click', copyRepoUrl);
  }
});
