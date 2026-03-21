let allServants = [];
let activePool = [];
let dag = {};
let reachable = {};
let history = [];
let undoStack = []; 

// Merge tournament state
let mergedRound = [];
let mergeRounds = [];       
let currentRound = 0;
let currentMergeIndex = 0;
let currentPair = null;

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
    mergeRounds = [pool.map(s => [s])];
    currentRound = 0;
    currentMergeIndex = 0;
    showNextPair();
}

// ------------------ 5. Show Next Pair (ITERATIVE) ------------------
function showNextPair() {
    while (true) {
        const round = mergeRounds[currentRound];

        // Checks if all the merges were done for the round
        if (currentMergeIndex >= round.length - 1) {
            // If there's a lone sublist at the end, move it up
            if (currentMergeIndex === round.length - 1) {
                mergedRound.push(round[currentMergeIndex]);
            }
            
            // Move to the next round
            mergeRounds.push(mergedRound);
            mergedRound = [];
            currentRound++;
            currentMergeIndex = 0;

            // If only one sublist remains and it's full, the sorting is completed.
            if (mergeRounds[currentRound].length === 1 && 
                mergeRounds[currentRound][0].length === activePool.length) {
                activePool = mergeRounds[currentRound][0];
                showResults();
                return;
            }
            continue;
        }

        const left = round[currentMergeIndex];
        const right = round[currentMergeIndex + 1];

        // Transitivity check
        if (hasPath(left[0].id, right[0].id)) {
            vote(0); // Left wins automatically
            return;
        }
        if (hasPath(right[0].id, left[0].id)) {
            vote(1); // Right wins automatically
            return;
        }

        // Manual Vote Required
        currentPair = { a: left[0], b: right[0] };
        renderServant('cardA', currentPair.a);
        renderServant('cardB', currentPair.b);
        updateProgressBar();
        return;
    }
}

// ------------------ 6. Vote ------------------
function vote(winnerIdx) {
    undoStack.push(JSON.parse(JSON.stringify({
        mergeRounds, mergedRound, currentRound, currentMergeIndex, dag, history, reachable: serializeReachable()
    })));
    if (undoStack.length > 20) undoStack.shift();

    const round = mergeRounds[currentRound];
    if (!round || !round[currentMergeIndex + 1]) return;

    const leftList = round[currentMergeIndex];
    const rightList = round[currentMergeIndex + 1];

    if (winnerIdx === 'tie') {
        if (!mergedRound[currentMergeIndex / 2]) mergedRound[currentMergeIndex / 2] = [];
        mergedRound[currentMergeIndex / 2].push(leftList.shift());
        mergedRound[currentMergeIndex / 2].push(rightList.shift());

        // Record tie
        history.push({ tie: [mergedRound[currentMergeIndex / 2][0].id, mergedRound[currentMergeIndex / 2][1].id] });

    } else {
        // Determine winner and all losers
        const winnerList = winnerIdx === 0 ? leftList : rightList;
        const loserList = winnerIdx === 0 ? rightList : leftList;

        // Add edges from winner to **all remaining losers** in this pair
        winnerList.forEach(win => {
            loserList.forEach(los => addEdge(win.id, los.id));
        });

        // Record history for each loser
        winnerList.forEach(win => {
            loserList.forEach(los => history.push({ win: win.id, los: los.id }));
        });

        // Move winner(s) to mergedRound
        if (!mergedRound[currentMergeIndex / 2]) mergedRound[currentMergeIndex / 2] = [];
        mergedRound[currentMergeIndex / 2].push(...winnerList.splice(0, winnerList.length));

        // Move remaining survivors if one side is empty
        if (leftList.length === 0 || rightList.length === 0) {
            const survivors = leftList.length > 0 ? leftList : rightList;
            while (survivors.length > 0) mergedRound[currentMergeIndex / 2].push(survivors.shift());
        }
    }

    currentMergeIndex += 2;
    saveState();
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
            if (hasPath(a, b) || hasPath(b, a)) {
                known += 1; // Strictly known
            } else if (history.some(h => h.tie && h.tie.includes(a) && h.tie.includes(b))) {
                known += 0.5; // Tie counts as half
            }
        }
    }

    const max = n * (n - 1) / 2;
    const percent = Math.round((known / max) * 100) || 0;

    document.getElementById('progress-bar').style.width = percent + "%";
    document.getElementById('progress-text').innerText = `Progress: ${percent}%`;
}

// ------------------ 8. Results ------------------
function showResults() {
    document.getElementById('arena').style.display = 'none';
    document.getElementById('results').style.display = 'block';

    const sortedIds = topologicalSort();
    let lastId = null;
    let rank = 0;
    let html = '';

    sortedIds.forEach((id, idx) => {
        const s = allServants.find(x => x.id === id);

        // Increment rank only if previous node has a DAG edge to this one
        if (!lastId || hasPath(lastId, id)) {
            rank = idx + 1;
        }
        html += `<div>${rank}. <b>${s.name}</b> (${s.class})</div>`;
        lastId = id;
    });

    document.getElementById('rank-list').innerHTML = html;
}

function topologicalSort() {
    const nodes = activePool.map(s => s.id);
    const sorted = [];
    const visited = new Set();

    const visit = (n) => {
        if (visited.has(n)) return;
        visited.add(n);
        (dag[n] || []).forEach(visit);
        sorted.unshift(n); 
    };

    nodes.forEach(visit);

    return sorted;
}

// ------------------ 9. Undo / Save / Load ------------------
function undo() {
    if (undoStack.length === 0) return alert("Nothing to undo!");

    const prevState = undoStack.pop();
    
    // Restore variables
    mergeRounds = prevState.mergeRounds;
    mergedRound = prevState.mergedRound;
    currentRound = prevState.currentRound;
    currentMergeIndex = prevState.currentMergeIndex;
    dag = prevState.dag;
    history = prevState.history;
    
    // Restore reachable Sets
    reachable = {};
    for (let key in prevState.reachable) {
        reachable[key] = new Set(prevState.reachable[key]);
    }

    saveState();
    showNextPair();
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