// Wait up to a couple minutes for the page to be fully loaded,
// including images.
//
// Meant to be executed in the context of the tab contents via
// chrome.scripting.executeScript.
//
// Returns a Promise that will be resolved once the page is loaded
// or will reject if that's taking too long.
function fullyLoaded() {
    return new Promise((resolve, reject) => {
        if (document.readyState === 'complete') {
            resolve('ready!');
        } else {
            document.addEventListener('load', () => { resolve('ready!') });
        }
        setTimeout(() => reject(new Error('Took too long')), 2 * 60 * 1000);
    });
}

// Find all the unique URLs for posts/conversations on the index page.
//
// Meant to be executed in the context of the tab contents via
// chrome.scripting.executeScript.
//
// Returns a Promise that will resolve with the array of unique URLs.
function findPostUrls() {
    const urls = [...document.querySelectorAll('[role="gridcell"] a[href^="./g/"]')].map((a) => a.href);
    const uniqueUrls = Array.from(new Set(urls));
    return new Promise((resolve, reject) => { resolve(uniqueUrls); });
}

function clickNext() {
    const nextButton = document.querySelector('[aria-label="Next page"]');
    let clicked = false;
    if (nextButton && window.getComputedStyle(nextButton).cursor === 'pointer') {
        console.log('Clicking Next page');
        nextButton.click();
        clicked = true;
    } else {
        console.log('Not clicking Next page');
    }
    return new Promise((resolve, reject) => { resolve(clicked); });
}

// Return a Promise that will resolve after the given number of milliseconds.
function delay(millis) {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, millis);
    });
}

async function getPostUrlsAcrossIndex(tab) {
    if (!/^https:\/\/groups\.google\.com\/g\/[^\/]+$/.test(tab.url)) {
        throw new Error(`Can only run on index page for a Google Group, not ${tab.url}`);
    }
    const urls = new Set();
    do {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: fullyLoaded
        });
        const urlsResult = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: findPostUrls
        });
        for (let url of urlsResult[0].result) {
            urls.add(url);
            console.log(`Found ${url}`);
        }
        const clickedResult = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: clickNext
        });
        if (!clickedResult[0].result) {
            break;
        }
        await delay(700 + 500 * Math.random());
    } while (true);
    return Array.from(urls);
}

async function downloadUrlCapture(tab_id, url) {
    try {
        chrome.tabs.update(tab_id, { url });
        // Wait a teeny bit for the update to actually happen.
        // TODO: is this actually helpful?
        await delay(10);
        await chrome.scripting.executeScript({
            target: { tabId: tab_id },
            func: fullyLoaded
        });
        const blob = await chrome.pageCapture.saveAsMHTML({ tabId: tab_id });
        const content = await blob.text();
        const dataUrl = "data:application/x-mimearchive;base64," + btoa(content);
        const postName = url.split('/').pop();
        await chrome.downloads.download({ url: dataUrl, filename: `${postName}.mhtml` });
    } catch (error) {
        console.log(`Failed to download ${url}`, error);
        return false;
    }
    return true;
}

chrome.action.onClicked.addListener(async (tab) => {
    const urls = await getPostUrlsAcrossIndex(tab);
    console.log(`Found ${urls.length} URLs`);
    console.log(`URLs: ${urls}`);
    let first = true;
    let downloadCount = 0;
    for (let url of urls) {
        console.log('Processing URL ', url);
        if (!first) {
            // Add some delay to be friendlier to Google's servers.
            await delay(7000 + 23000 * Math.random());
        } else {
            first = false;
        }
        let successful = false;
        for (let tries = 0; tries < 3; tries++) {
            successful = downloadUrlCapture(tab.id, url);
            if (successful) {
                break;
            }
        }
        if (!successful) {
            console.log(`All attempts for ${url} failed. Continuing.`);
        }
        downloadCount++;
        console.log('Download #', downloadCount);
    }
});