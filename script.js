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
                npTypes // ← NEW
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
    if (undoStack.length > 20) undoStack.shift(); // Limit memory usage

    const round = mergeRounds[currentRound];
    if (!round || !round[currentMergeIndex + 1]) return;
    const leftList = round[currentMergeIndex];
    const rightList = round[currentMergeIndex + 1];

    // 1. Identify winner and loser based on the button clicked
    const win = winnerIdx === 0 ? leftList.shift() : rightList.shift();
    const los = winnerIdx === 0 ? rightList[0] : leftList[0];

    // 2. Record the relationship for transitivity (the DAG)
    // Only add the edge if there is actually a loser left to compare against
    if (los) {
        addEdge(win.id, los.id);
        history.push({ win: win.id, los: los.id });
    }

    // 3. Move the winner to the temporary "merged" results for this pair
    if (!mergedRound[currentMergeIndex / 2]) {
        mergedRound[currentMergeIndex / 2] = [];
    }
    mergedRound[currentMergeIndex / 2].push(win);

    // 4. If one side of the duel is empty, move the survivors of the other side over
    if (leftList.length === 0 || rightList.length === 0) {
        const survivors = leftList.length > 0 ? leftList : rightList;
        while (survivors.length > 0) {
            mergedRound[currentMergeIndex / 2].push(survivors.shift());
        }
        // This pair of sublists is fully merged; move to the next pair
        currentMergeIndex += 2;
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
            ${servant.rarity}★ ${servant.class}
        </div>
    `;
}

function updateProgressBar() {
    const n = activePool.length;

    // --- Merge progress ---
    let placed = 0;
    for (let i = 0; i < currentRound; i++) {
        for (const sub of mergeRounds[i]) placed += sub.length;
    }
    for (const sub of mergedRound) placed += sub.length;

    const mergeProgress = placed / n;

    // --- Knowledge progress ---
    let known = history.length;
    const estimatedMax = n * Math.log2(n); // merge-sort comparison estimate

    const knowledgeProgress = Math.min(known / estimatedMax, 1);

    // --- Blend ---
    const combined = (mergeProgress * 0.7) + (knowledgeProgress * 0.3);

    const percent = Math.round(combined * 100);

    document.getElementById('progress-bar').style.width = percent + "%";
    document.getElementById('progress-text').innerText =
    `Progress: ${percent}% (${history.length} comparisons)`;
}

// ------------------ 8. Results ------------------
function showResults() {
    document.getElementById('arena').style.display = 'none';
    document.getElementById('results').style.display = 'block';

    const sortedIds = topologicalSort();
    document.getElementById('rank-list').innerHTML = sortedIds.map((id, idx) => {
        const s = allServants.find(x => x.id === id);
        return `<div>${idx + 1}. <b>${s.name}</b> (${s.class})</div>`;
    }).join('');
}

function topologicalSort() {
    let nodes = activePool.map(s => s.id), sorted = [], visited = new Set();
    const visit = (n) => {
        if (visited.has(n)) return;
        visited.add(n);
        (dag[n] || []).forEach(visit);
        sorted.unshift(n); // Adds to front
    };
    nodes.forEach(visit);
    return sorted; // No reverse needed if using unshift
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