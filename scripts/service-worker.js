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

// Return a Promise that will resolve after the given number of milliseconds.
function delay(millis) {
    return new Promise((resolve, reject) => {
        setTimeout(resolve, millis);
    });
}

chrome.action.onClicked.addListener(async (tab) => {
    if (!/^https:\/\/groups\.google\.com\/g\/[^\/]+$/.test(tab.url)) {
        console.log('Can only run on index page for a Google Group, not ', tab.url);
        return;
    }
    await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: fullyLoaded
    });
    const urlsResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: findPostUrls
    });
    const urls = urlsResult[0].result;
    console.log(`Found ${urls.length} URLs`);
    let first = true;
    let downloadCount = 0;
    for (let url of urls) {
        console.log('Processing URL ', url);
        if (!first) {
            // Add some delay to be friendlier to Google's servers.
            await delay(5000 + 10000 * Math.random());
        } else {
            first = false;
        }
        chrome.tabs.update(tab.id, { url });
        // Wait a teeny bit for the update to actually happen.
        // TODO: is this actually helpful?
        await delay(10);
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: fullyLoaded
        });
        const blob = await chrome.pageCapture.saveAsMHTML({ tabId: tab.id });
        const content = await blob.text();
        const dataUrl = "data:application/x-mimearchive;base64," + btoa(content);
        const postName = url.split('/').pop();
        await chrome.downloads.download({ url: dataUrl, filename: `${postName}.mhtml` });
        downloadCount++;
        console.log('Download #', downloadCount);
    }
});