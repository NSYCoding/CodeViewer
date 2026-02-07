window.addEventListener('DOMContentLoaded', () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(err =>
            console.warn('Service Worker registration failed:', err)
        );
    }
    initializeApp();
});

const DB_VERSION = 8;
let currentRepo = null;
let currentRepoFiles = [];

async function openDB() {
    return new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) {
            reject(new Error('IndexedDB not supported'));
            return;
        }
        const request = indexedDB.open('CodeViewerDB', DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            if (db.objectStoreNames.contains('tokens')) {
                db.deleteObjectStore('tokens');
            }
            db.createObjectStore('tokens', { keyPath: 'key' });
        };
    });
}

function saveTokenFallback(token) {
    try {
        localStorage.setItem('github_token', token);
        return true;
    } catch {
        return false;
    }
}

async function saveToken(token) {
    try {
        const db = await openDB();
        const tx = db.transaction('tokens', 'readwrite');
        const store = tx.objectStore('tokens');

        if (store.keyPath === 'key') {
            store.put({ key: 'github_token', value: token });
        } else {
            store.put({ value: token }, 'github_token');
        }

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.warn('IndexedDB save failed, falling back to localStorage:', err);
        if (!saveTokenFallback(token)) throw err;
        return true;
    }
}

function getTokenFallback() {
    try {
        return localStorage.getItem('github_token');
    } catch {
        return null;
    }
}

function deleteTokenFallback() {
    try {
        localStorage.removeItem('github_token');
    } catch {
        // no-op
    }
}

async function getToken() {
    try {
        const db = await openDB();
        const tx = db.transaction('tokens', 'readonly');
        const store = tx.objectStore('tokens');
        const request = store.get('github_token');

        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result?.value);
            request.onerror = () => reject(request.error);
        });
    } catch (err) {
        console.warn('IndexedDB get failed, falling back to localStorage:', err);
        return getTokenFallback();
    }
}

async function deleteToken() {
    try {
        const db = await openDB();
        const tx = db.transaction('tokens', 'readwrite');
        const store = tx.objectStore('tokens');
        store.delete('github_token');

        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.warn('IndexedDB delete failed, falling back to localStorage:', err);
        deleteTokenFallback();
        return true;
    }
}

async function fetchPrivateRepos() {
    const token = await getToken();
    if (!token) {
        window.location.href = './login.html';
        return [];
    }

    const headers = {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
    };

    try {
        const response = await fetch('https://api.github.com/user/repos?sort=updated&per_page=10', { headers });
        if (!response.ok) throw new Error('Failed to fetch repos');
        return await response.json();
    } catch (err) {
        console.error('Error fetching repos:', err);
        return [];
    }
}

async function fetchFileContent(owner, repo, path) {
    const token = await getToken();
    const headers = {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.raw+json'
    };

    try {
        const response = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
            { headers }
        );
        if (!response.ok) throw new Error('File not found');
        return await response.text();
    } catch (err) {
        console.error('Error fetching file:', err);
        return 'Error loading file content';
    }
}

async function fetchComments(owner, repo, path) {
    const token = await getToken();
    const headers = {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
    };

    try {
        const response = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/commits?path=${path}&per_page=5`,
            { headers }
        );
        if (!response.ok) return [];
        const commits = await response.json();
        return commits;
    } catch (err) {
        console.error('Error fetching comments:', err);
        return [];
    }
}

async function fetchRepoTree(owner, repo, branch) {
    const token = await getToken();
    const headers = {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
    };

    try {
        const response = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
            { headers }
        );
        if (!response.ok) throw new Error('Failed to fetch repo tree');
        const data = await response.json();

        return (data.tree || [])
            .filter(item => item.type === 'blob')
            .sort((a, b) => a.path.localeCompare(b.path));
    } catch (err) {
        console.error('Error fetching repo tree:', err);
        return [];
    }
}

function renderFileList(files, repo) {
    const fileItems = document.getElementById('file-items');
    if (!fileItems) return;

    if (!files.length) {
        fileItems.innerHTML = '<p style="padding: 10px; opacity: 0.6; font-size: 0.85rem;">No files matching filter</p>';
        return;
    }

    fileItems.innerHTML = files
        .map(file => `<div class="file-item" data-path="${file.path}" title="${file.path}">${file.path}</div>`)
        .join('');

    fileItems.onclick = async (event) => {
        const item = event.target.closest('.file-item');
        if (!item) return;

        // Visual sorting via CSS class
        document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');

        const path = item.getAttribute('data-path');
        const fileInput = document.getElementById('file-path');
        if (fileInput) fileInput.value = path;

        await loadFile(repo, path);
    };
}

async function displayFileComments(commits) {
    const commentsSection = document.querySelector('.comments');
    if (!commentsSection) return;

    if (commits.length === 0) {
        commentsSection.innerHTML = '<p style="opacity: 0.7;">No commit history</p>';
        return;
    }

    commentsSection.innerHTML = commits.map(commit => `
        <div class="comment-item">
            <strong class="comment-author">${commit.commit.author.name}</strong>
            <p class="comment-msg">${commit.commit.message}</p>
            <small class="comment-date">${new Date(commit.commit.author.date).toLocaleDateString()}</small>
        </div>
    `).join('');
}

async function loadFile(repo, path) {
    const codeTextarea = document.getElementById('code');
    if (!codeTextarea) return;

    // Highlight in list if loading manually
    const activeItem = document.querySelector(`.file-item[data-path="${path}"]`);
    if (activeItem) {
        document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
        activeItem.classList.add('active');
        activeItem.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    codeTextarea.value = 'Loading file content...';
    const fileContent = await fetchFileContent(repo.owner.login, repo.name, path);
    const commits = await fetchComments(repo.owner.login, repo.name, path);

    codeTextarea.value = fileContent;
    await displayFileComments(commits);
}

async function initializeApp() {
    const codeTextarea = document.getElementById('code');
    const loginForm = document.getElementById('login-form');

    if (loginForm) {
        loginForm.onsubmit = async function (e) {
            e.preventDefault();

            const username = document.getElementById('username').value.trim();
            const token = document.getElementById('token').value.trim();

            if (!username || !token) {
                alert('Please enter both username and token');
                return;
            }

            const submitBtn = loginForm.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Saving...';

            try {
                await saveToken(token);
                localStorage.setItem('user', username);
                window.location.href = './index.html';
            } catch (err) {
                alert('Failed to save credentials. Please try again.');
                console.error('Save error:', err);
                submitBtn.disabled = false;
                submitBtn.textContent = 'Login';
            }
        };
        return;
    }

    if (codeTextarea) {
        const token = await getToken();
        const user = localStorage.getItem('user');

        if (!token || !user) {
            window.location.href = './login.html';
            return;
        }

        codeTextarea.value = 'Loading your repositories...';

        try {
            const repos = await fetchPrivateRepos();

            if (repos.length > 0) {
                currentRepo = repos[0];

                const files = await fetchRepoTree(
                    currentRepo.owner.login,
                    currentRepo.name,
                    currentRepo.default_branch
                );
                currentRepoFiles = files;
                renderFileList(currentRepoFiles, currentRepo);

                const readme = currentRepoFiles.find(f => f.path.toLowerCase() === 'readme.md');
                const defaultPath = readme?.path || currentRepoFiles[0]?.path;

                if (defaultPath) {
                    await loadFile(currentRepo, defaultPath);
                } else {
                    codeTextarea.value = 'No files found in this repository.';
                }

                const fileFilter = document.getElementById('file-filter');
                if (fileFilter) {
                    fileFilter.oninput = () => {
                        const query = fileFilter.value.trim().toLowerCase();
                        const filtered = query
                            ? currentRepoFiles.filter(file => file.path.toLowerCase().includes(query))
                            : currentRepoFiles;
                        renderFileList(filtered, currentRepo);
                    };
                }

                addRepoSelector(repos, async (repo) => {
                    currentRepo = repo;
                    const updatedFiles = await fetchRepoTree(
                        repo.owner.login,
                        repo.name,
                        repo.default_branch
                    );
                    currentRepoFiles = updatedFiles;
                    renderFileList(currentRepoFiles, repo);

                    const repoReadme = currentRepoFiles.find(f => f.path.toLowerCase() === 'readme.md');
                    const repoDefault = repoReadme?.path || currentRepoFiles[0]?.path;

                    if (repoDefault) {
                        await loadFile(repo, repoDefault);
                    } else {
                        codeTextarea.value = 'No files found in this repository.';
                    }
                });
            } else {
                codeTextarea.value = 'No repositories found. Please create a repository on GitHub.';
            }
        } catch (err) {
            codeTextarea.value = 'Error loading content. Please try again.';
            console.error(err);
        }

        const logoutBtn = document.createElement('button');
        logoutBtn.className = 'install-button';
        logoutBtn.innerHTML = '🚪';
        logoutBtn.title = `Logout (${user})`;
        logoutBtn.onclick = async () => {
            await deleteToken();
            localStorage.removeItem('user');
            window.location.href = './login.html';
        };
        document.body.appendChild(logoutBtn);
    }
}

async function addRepoSelector(repos, onSelect) {
    if (document.getElementById('repo-selector')) return;

    const selector = document.createElement('div');
    selector.id = 'repo-selector';

    const select = document.createElement('select');

    repos.forEach(repo => {
        const option = document.createElement('option');
        option.value = repo.name;
        option.textContent = repo.name;
        select.appendChild(option);
    });

    select.onchange = async (e) => {
        const repoName = e.target.value;
        const repo = repos.find(r => r.name === repoName);
        if (!repo) return;

        if (typeof onSelect === 'function') onSelect(repo);
    };

    selector.appendChild(select);
    document.body.appendChild(selector);
}