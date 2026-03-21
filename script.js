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

const classMap = {
    "shielder": "Shielder",
    "saber": "Saber",
    "archer": "Archer",
    "lancer": "Lancer",
    "rider": "Rider",
    "caster": "Caster",
    "assassin": "Assassin",
    "berserker": "Berserker",
    "ruler": "Ruler",
    "avenger": "Avenger",
    "moonCancer": "Moon Cancer",
    "alterEgo": "Alter Ego",
    "pretender": "Pretender",
    "foreigner": "Foreigner",
    "beast": "Beast",
};

function formatClassName(className) {
    return classMap[className] || className.charAt(0).toUpperCase() + className.slice(1);
}

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
    if (!reachable[win]) reachable[win] = new Set();
    if (!reachable[los]) reachable[los] = new Set();

    if (reachable[win].has(los)) return; // Already known

    reachable[win].add(los);
    // Everything reachable from 'los' is now reachable from 'win'
    reachable[los].forEach(item => reachable[win].add(item));

    // Everything that can reach 'win' can now reach everything 'win' can reach
    for (let node in reachable) {
        if (reachable[node].has(win)) {
            reachable[win].forEach(item => reachable[node].add(item));
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

    // Clear queues one last time right before starting
    currentQueue = [];
    nextQueue = [];
    leftRemaining = [];
    rightRemaining = [];

    // Shuffle and start
    activePool = activePool.sort(() => Math.random() - 0.5);
    initMergeRounds(activePool);

    document.getElementById('setup-menu').style.display = 'none';
    document.getElementById('arena').style.display = 'block';
}

// ------------------ 4. Merge-Round Setup ------------------
function initMergeRounds(pool) {
    // Wrap each servant in a single-element array
    currentQueue = pool.map(s => [s]);
    nextQueue = [];
    showNextPair();
}

// New state variables for the merge process
let leftRemaining = [];
let rightRemaining = [];
let mergedResult = [];

function showNextPair() {
    while (true) {
        // 1. If we aren't currently merging two lists, grab the next two from the queue
        if (leftRemaining.length === 0 && rightRemaining.length === 0) {
            if (currentQueue.length <= 1) {
                if (currentQueue.length === 1) nextQueue.push(currentQueue.shift());
                
                if (nextQueue.length === 1 && nextQueue[0].length === activePool.length) {
                    activePool = nextQueue[0];
                    showResults();
                    return;
                }
                currentQueue = nextQueue;
                nextQueue = [];
                continue; 
            }
            leftRemaining = currentQueue.shift();
            rightRemaining = currentQueue.shift();
            mergedResult = [];
        }

        // 2. If one side is empty, push the rest of the other side to mergedResult
        if (leftRemaining.length === 0) {
            mergedResult.push(...rightRemaining);
            rightRemaining = [];
            nextQueue.push(mergedResult);
            continue;
        }
        if (rightRemaining.length === 0) {
            mergedResult.push(...leftRemaining);
            leftRemaining = [];
            nextQueue.push(mergedResult);
            continue;
        }

        const leftItem = leftRemaining[0];
        const rightItem = rightRemaining[0];

        // 3. Automated Transitivity Check
        if (hasPath(leftItem.id, rightItem.id)) {
            mergedResult.push(leftRemaining.shift());
            continue;
        }
        if (hasPath(rightItem.id, leftItem.id)) {
            mergedResult.push(rightRemaining.shift());
            continue;
        }

        // 4. Manual Vote Required
        currentPair = { a: leftItem, b: rightItem };
        renderServant('cardA', leftItem);
        renderServant('cardB', rightItem);
        updateProgressBar();
        break;
    }
}

function vote(winnerIdx) {
    if (!currentPair) return;
    pushToUndo();

    const leftItem = leftRemaining[0];
    const rightItem = rightRemaining[0];

    if (winnerIdx === 0) { // Left Wins
        addEdge(leftItem.id, rightItem.id);
        history.push({ win: leftItem.id, los: rightItem.id });
        mergedResult.push(leftRemaining.shift());
    } else if (winnerIdx === 1) { // Right Wins
        addEdge(rightItem.id, leftItem.id);
        history.push({ win: rightItem.id, los: leftItem.id });
        mergedResult.push(rightRemaining.shift());
    } else { // Tie
        history.push({ tie: [leftItem.id, rightItem.id] });
        // In a tie, we move both to the merged result as a "unit"
        mergedResult.push(leftRemaining.shift());
        mergedResult.push(rightRemaining.shift());
    }

    saveState();
    showNextPair();
}

// ------------------ 7. Render & Progress ------------------
function renderServant(elementId, servant) {
    document.getElementById(elementId).innerHTML = `
        <img src="${servant.img || ''}" loading="lazy">
        <div class="card-info">
            <b>${servant.name}</b><br>
            ${servant.rarity}★ ${formatClassName(servant.class)}
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
            // Use formatClassName here:
            html += `<div>${rank}. <b>${s.name}</b> (${formatClassName(s.class)})</div>`;
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
    const savedRaw = localStorage.getItem('fgo_sorter_save');
    if (!savedRaw) return;

    const saved = JSON.parse(savedRaw);
    // If the saved pool is empty, treat it as no save
    if (!saved.activePool || saved.activePool.length === 0) return;

    dag = saved.dag || {};
    history = saved.history || [];
    activePool = saved.activePool;
    
    // Restore reachable Sets
    reachable = {};
    if (saved.reachable) {
        for (let key in saved.reachable) {
            reachable[key] = new Set(saved.reachable[key]);
        }
    }

    // IMPORTANT: After loading data, we need to re-initialize the queues
    // or restore the exact queue state from the save.
    // For now, let's just re-init the merge rounds:
    initMergeRounds(activePool);

    document.getElementById('setup-menu').style.display = 'none';
    document.getElementById('arena').style.display = 'block';
}

// ------------------ 10. New Ranking ------------------
function startNewRanking() {
    localStorage.removeItem('fgo_sorter_save');
    
    // Reset Logic & Graph
    dag = {};
    reachable = {};
    history = [];
    undoStack = []; // Clear the undo history too!
    
    // Reset Merge Queues (CRITICAL)
    currentQueue = [];
    nextQueue = [];
    leftRemaining = [];
    rightRemaining = [];
    mergedResult = [];
    currentPair = null;
    activePool = [];

    // UI Resets
    document.getElementById('setup-menu').style.display = 'block';
    document.getElementById('arena').style.display = 'none';
    document.getElementById('results').style.display = 'none';
    
    document.getElementById('progress-bar').style.width = '0%';
    document.getElementById('progress-text').innerText = 'Progress: 0%';
}

// ------------------ 11. Start ------------------
async function start() {
    await loadServants();
    loadState();
}

start();