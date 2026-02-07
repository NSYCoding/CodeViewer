if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
}

let installPrompt = null;

// Listen for the beforeinstallprompt event
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  
  // Show install button
  showInstallButton();
});

function showInstallButton() {
  const installButton = document.createElement('button');
  installButton.textContent = 'Install App';
  installButton.style.position = 'fixed';
  installButton.style.bottom = '20px';
  installButton.style.right = '20px';
  installButton.style.zIndex = '1000';
  installButton.style.backgroundColor = '#007bff';
  installButton.style.color = 'white';
  installButton.style.border = 'none';
  installButton.style.borderRadius = '50%';
  installButton.style.width = '60px';
  installButton.style.height = '60px';
  installButton.style.cursor = 'pointer';
  installButton.style.fontSize = '24px';
  installButton.style.textAlign = 'center';
  installButton.style.lineHeight = '60px';
  
  installButton.onclick = () => {
    if (installPrompt) {
      installPrompt.prompt();
      installPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
          console.log('User accepted the install prompt');
        } else {
          console.log('User dismissed the install prompt');
        }
        installPrompt = null;
      });
    }
  };
  
  document.body.appendChild(installButton);
}