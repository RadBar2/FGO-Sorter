let allServants = [];
let activePool = [];
let dag = {};
let reachable = {};
let history = [];
let undoStack = [];

let currentQueue = []; // pairs to compare this round
let nextQueue = [];    // winners/tied groups for next round
let currentPair = null;

let mergedRound = [];
let mergeRounds = [];
let currentRound = 0;
let currentMergeIndex = 0;

const darkMode = window.matchMedia('(prefers-color-scheme: dark)');

function updateTheme(e) {
  if (e.matches) {
    document.body.classList.add('dark');
  } else {
    document.body.classList.remove('dark');
  }
}

darkMode.addEventListener('change', updateTheme);
updateTheme(darkMode);

// ------------------ 1. Load Servants ------------------
async function loadServants() {
    const url = "https://api.atlasacademy.io/export/JP/nice_servant_lang_en.json"

    const res = await fetch(url);
    const data = await res.json();

    allServants = data
        .filter(s => s.collectionNo)
        .map(servant => {
            const nps = servant.noblePhantasms || [];
            const cardMap = { 1: "arts", 2: "buster", 3: "quick" };

            let npTypes = [];

            nps.forEach(np => {
                const cardMap = { 1: "arts", 2: "buster", 3: "quick" };

                let color = cardMap[np.card] || null;
                let type = "support";

                if (np.functions) {
                    for (const f of np.functions) {
                        const isDamage = f.funcType.includes("damageNp");
                        if (isDamage) {
                            if (f.funcTargetType === "enemyAll") { type = "aoe"; break; }
                            if (f.funcTargetType === "enemy") type = "st";
                        }
                    }
                }

                if (color) {
                    npTypes.push({ color, type });
                }
            });

            return {
                id: servant.id,
                name: servant.name,
                class: (servant.className.toLowerCase().includes("beast") ? "beast" : servant.className),
                rarity: servant.rarity,
                gender: (servant.gender || "unknown").toLowerCase().replace("gender", ""),
                img: getServantImage(servant),
                npTypes 
            };
        });

    preloadImages();
}

function getServantImage(servant) {
    const faces = servant.extraAssets?.faces?.ascension;
    const narrow = servant.extraAssets?.narrowFigure?.ascension;
    const chara = servant.extraAssets?.charaGraph?.ascension;
    return (faces ? Object.values(faces)[0] :
            narrow ? Object.values(narrow)[0] :
            chara ? Object.values(chara)[0] : null);
}

function preloadImages() {
    allServants.forEach(s => {
        if (!s.img) return;
        const img = new Image();
        img.src = s.img;
    });
}

// ------------------ 2. DAG / Transitivity ------------------
function addEdge(win, los) {
    if (!dag[win]) dag[win] = [];
    dag[win].push(los);

    if (!reachable[win]) reachable[win] = new Set();
    if (!reachable[los]) reachable[los] = new Set();

    reachable[win].add(los);
    reachable[win] = new Set([...reachable[win], ...reachable[los]]);

    for (let node in reachable) {
        if (reachable[node].has(win)) {
            reachable[node] = new Set([...reachable[node], ...reachable[win]]);
        }
    }
}

function hasPath(start, target) {
    return reachable[start]?.has(target) || false;
}

// ------------------ 3. Ranking Setup ------------------
function initRanking() {
    const selClasses = Array.from(document.querySelectorAll('.class-check:checked')).map(i => i.value);
    const selRarities = Array.from(document.querySelectorAll('.rarity-check:checked')).map(i => parseInt(i.value));
    const selColors = Array.from(document.querySelectorAll('.color-check:checked')).map(i => i.value);
    const selTypes = Array.from(document.querySelectorAll('.type-check:checked')).map(i => i.value);
    const selGenders = Array.from(document.querySelectorAll('.gender-check:checked')).map(i => i.value);

    console.log(allServants);

    activePool = allServants.filter(s =>
        selClasses.includes(s.class) &&
        selRarities.includes(s.rarity) &&
        selGenders.includes(s.gender) &&
        s.npTypes.some(np =>
            selColors.includes(np.color) &&
            selTypes.includes(np.type))       
    );

    if (activePool.length < 2) return alert("Pool is too small.");

    document.getElementById('setup-menu').style.display = 'none';
    document.getElementById('arena').style.display = 'block';

    // Shuffle randomly
    activePool = activePool.sort(() => Math.random() - 0.5);

    initMergeRounds(activePool);
}

// ------------------ 4. Merge-Round Setup ------------------
function initMergeRounds(pool) {
    // Wrap each servant in a single-element array
    currentQueue = pool.map(s => [s]);
    nextQueue = [];
    showNextPair();
}

// ------------------ 5. Show Next Pair (ITERATIVE) ------------------
function showNextPair() {
    // We use a loop to "fast-forward" through automated wins 
    // without adding to the call stack.
    while (true) {
        // A. Check if current round is finished
        if (currentQueue.length === 0) {
            if (nextQueue.length === 1 && nextQueue[0].length === activePool.length) {
                activePool = nextQueue[0];
                showResults();
                return; 
            }
            currentQueue = nextQueue;
            nextQueue = [];
        }

        // B. Handle the odd-one-out
        if (currentQueue.length === 1) {
            nextQueue.push(currentQueue.shift());
            continue; // Jump to next iteration of the loop
        }

        const left = currentQueue.shift();
        const right = currentQueue.shift();

        // C. Check transitivity (Automatic Wins)
        if (hasPath(left[0].id, right[0].id)) {
            // No need to call vote() here, just update data and CONTINUE the loop
            processWin(0, left, right, false); // false = don't push to undo for autos
            continue; 
        }
        if (hasPath(right[0].id, left[0].id)) {
            processWin(1, left, right, false);
            continue;
        }

        // D. MANUAL VOTE REQUIRED
        // We break the loop here to wait for the user to click a button.
        currentPair = { a: left[0], b: right[0], leftList: left, rightList: right };
        renderServant('cardA', left[0]);
        renderServant('cardB', right[0]);
        updateProgressBar();
        break; 
    }
}

// ------------------ 6. Vote ------------------
// New helper to handle the data side of a win/loss
function processWin(winnerIdx, leftList, rightList, isManual = true) {
    let group = [];
    
    if (winnerIdx === 'tie') {
        group.push(...leftList, ...rightList);
        history.push({ tie: [leftList[0].id, rightList[0].id] });
    } else {
        const winnerList = winnerIdx === 0 ? leftList : rightList;
        const loserList = winnerIdx === 0 ? rightList : leftList;

        winnerList.forEach(win => {
            loserList.forEach(los => {
                addEdge(win.id, los.id);
                if (isManual) history.push({ win: win.id, los: los.id });
            });
        });
        group.push(...winnerList);
    }

    nextQueue.push(group);
}

// Updated vote function for the buttons
function vote(winnerIdx) {
    pushToUndo();
    
    // Process the current pair
    processWin(winnerIdx, [currentPair.a], [currentPair.b], true);
    
    saveState();
    
    // Call showNextPair once to find the next manual matchup
    showNextPair();
}

// ------------------ 7. Render & Progress ------------------
function renderServant(elementId, servant) {
    document.getElementById(elementId).innerHTML = `
        <img src="${servant.img || ''}" loading="lazy">
        <div class="card-info">
            <b>${servant.name}</b><br>
            ${servant.rarity}★ ${servant.class}
        </div>
    `;
}

function updateProgressBar() {
    const n = activePool.length;
    let known = 0;

    for (let i = 0; i < n; i++) {
        const a = activePool[i].id;
        for (let j = i + 1; j < n; j++) {
            const b = activePool[j].id;
            if (hasPath(a, b) || hasPath(b, a)) known++;
            else if (history.some(h => h.tie && h.tie.includes(a) && h.tie.includes(b))) known += 0.5;
        }
    }

    const max = n * (n - 1) / 2;
    const percent = Math.round((known / max) * 100) || 0;

    document.getElementById('progress-bar').style.width = percent + '%';
    document.getElementById('progress-text').innerText = `Progress: ${percent}%`;
}

// ------------------ 8. Results ------------------
function showResults() {
    document.getElementById('arena').style.display = 'none';
    document.getElementById('results').style.display = 'block';

    // Build tie groups
    const tieGroups = {};
    activePool.forEach(s => tieGroups[s.id] = new Set([s.id]));

    history.forEach(h => {
        if (h.tie) {
            const [a, b] = h.tie;
            const union = new Set([...tieGroups[a], ...tieGroups[b]]);
            union.forEach(id => tieGroups[id] = union);
        }
    });

    // Topologically sort based on DAG and tie groups
    const nodes = activePool.map(s => s.id);
    const visited = new Set();
    const sortedGroups = [];

    const visit = (n) => {
        if (visited.has(n)) return;
        visited.add(n);

        (dag[n] || []).forEach(visit);

        const group = Array.from(tieGroups[n]);
        if (!sortedGroups.some(g => g.some(id => group.includes(id)))) {
            sortedGroups.push(group);
        }
    };

    nodes.forEach(visit);

    // Render HTML with tied ranks
    let html = '';
    let rank = 1;
    sortedGroups.forEach(group => {
        group.forEach(id => {
            const s = allServants.find(x => x.id === id);
            html += `<div>${rank}. <b>${s.name}</b> (${s.class})</div>`;
        });
        rank += group.length;
    });

    document.getElementById('rank-list').innerHTML = html;
}

// ------------------ 9. Undo / Save / Load ------------------
function pushToUndo() {
    // Deep clone the state objects
    const stateSnapshot = {
        dag: JSON.parse(JSON.stringify(dag)),
        history: JSON.parse(JSON.stringify(history)),
        currentQueue: JSON.parse(JSON.stringify(currentQueue)),
        nextQueue: JSON.parse(JSON.stringify(nextQueue)),
        currentPair: JSON.parse(JSON.stringify(currentPair)),
        // Sets need special handling
        reachable: serializeReachable() 
    };
    
    undoStack.push(stateSnapshot);
    
    // Optional: Limit stack size to prevent memory issues
    if (undoStack.length > 50) undoStack.shift();
}

function undo() {
    if (undoStack.length === 0) return alert("Nothing to undo!");

    const prevState = undoStack.pop();
    
    // Restore the specific variables your logic uses
    dag = prevState.dag;
    history = prevState.history;
    currentQueue = prevState.currentQueue;
    nextQueue = prevState.nextQueue;
    currentPair = prevState.currentPair;
    
    // Restore reachable Sets
    reachable = {};
    for (let key in prevState.reachable) {
        reachable[key] = new Set(prevState.reachable[key]);
    }

    // Re-render the UI based on the restored currentPair
    if (currentPair) {
        renderServant('cardA', currentPair.a);
        renderServant('cardB', currentPair.b);
    }
    
    updateProgressBar();
    saveState(); // Update local storage with the "new" old state
}

function saveState() {
    const state = {
        dag,
        history,
        activePool,
        mergeRounds,
        mergedRound,
        currentRound,
        currentMergeIndex,
        reachable: serializeReachable() // Reachable uses Sets, which need conversion
    };
    localStorage.setItem('fgo_sorter_save', JSON.stringify(state));
}

// Helper to handle the Sets in your reachable object
function serializeReachable() {
    let obj = {};
    for (let key in reachable) { obj[key] = Array.from(reachable[key]); }
    return obj;
}

function loadState() {
    const saved = JSON.parse(localStorage.getItem('fgo_sorter_save'));
    if (!saved || !saved.activePool || saved.activePool.length === 0) return;

    dag = saved.dag;
    history = saved.history;
    activePool = saved.activePool;

    initMergeRounds(activePool);
    document.getElementById('setup-menu').style.display = 'none';
    document.getElementById('arena').style.display = 'block';
}

// ------------------ 10. New Ranking ------------------
function startNewRanking() {
    localStorage.removeItem('fgo_sorter_save');
    
    // Reset ALL state variables
    dag = {};
    reachable = {};
    history = [];
    mergeRounds = [];
    mergedRound = []; // <--- This was likely keeping old data
    currentRound = 0;
    currentMergeIndex = 0;
    currentPair = null;
    activePool = [];

    // UI Resets
    document.getElementById('setup-menu').style.display = 'block';
    document.getElementById('arena').style.display = 'none';
    document.getElementById('results').style.display = 'none';
    
    // Progress bar reset
    document.getElementById('progress-bar').style.width = '0%';
    document.getElementById('progress-text').innerText = 'Progress: 0%';
}

// ------------------ 11. Start ------------------
async function start() {
    await loadServants();
    loadState();
}

start();