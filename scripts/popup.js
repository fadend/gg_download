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
    if (document.readyState === "complete") {
      resolve("ready!");
    } else {
      document.addEventListener("load", () => {
        resolve("ready!");
      });
    }
    setTimeout(() => reject(new Error("Took too long")), 2 * 60 * 1000);
  });
}

// Find all the unique URLs for posts/conversations on the index page.
//
// Meant to be executed in the context of the tab contents via
// chrome.scripting.executeScript.
//
// Returns a Promise that will resolve with the array of unique URLs.
function findPostUrls() {
  const urls = [
    ...document.querySelectorAll('[role="gridcell"] a[href^="./g/"]'),
  ].map((a) => a.href);
  const uniqueUrls = Array.from(new Set(urls));
  return new Promise((resolve, reject) => {
    resolve(uniqueUrls);
  });
}

// Click the "Next page" button to get to the next page of the index.
// To be used with chrome.scripting.executeScript.
// Returns a Promise to pass back whether the click happened.
function clickNextPage() {
  const nextButton = document.querySelector('[aria-label="Next page"]');
  let clicked = false;
  if (nextButton && window.getComputedStyle(nextButton).cursor === "pointer") {
    console.log("Clicking Next page");
    nextButton.click();
    clicked = true;
  } else {
    console.log("Not clicking Next page");
  }
  return new Promise((resolve, reject) => {
    resolve(clicked);
  });
}

// Return a Promise that will resolve after the given number of milliseconds.
function delay(millis) {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, millis);
  });
}

// Gets the URLs for all posts, starting from the first page of the index.
async function getPostUrlsAcrossIndex(tab, maxCount) {
  if (!/^https:\/\/groups\.google\.com\/g\/[^\/]+$/.test(tab.url)) {
    throw new Error(
      `Can only run on index page for a Google Group, not ${tab.url}`,
    );
  }
  const urls = new Set();
  do {
    if (maxCount >= 0 && urls.size >= maxCount) {
      break;
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fullyLoaded,
    });
    const urlsResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: findPostUrls,
    });
    for (let url of urlsResult[0].result) {
      urls.add(url);
      console.log(`Found ${url}`);
    }
    const clickedResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: clickNextPage,
    });
    if (!clickedResult[0].result) {
      break;
    }
    await delay(700 + 500 * Math.random());
  } while (true);
  return Array.from(urls);
}

// Load the given URL in the given tab.
function loadUrl(tabId, url) {
  return new Promise((resolve, reject) => {
    // Thank you, https://stackoverflow.com/a/18436493.
    chrome.tabs.update(tabId, { url }, (tab) => {
      const listener = (targetTabId, changeInfo, targetTab) => {
        if (targetTabId === tab.id && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          if (targetTab.url === url) {
            resolve(targetTab);
          } else {
            reject(
              new Error(`completed with wrong URL: ${targetTab.url} != ${url}`),
            );
          }
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

async function downloadUrlCapture(tab, url) {
  try {
    const updateStartTimeSeconds = +new Date() / 1000;
    let newTab = await loadUrl(tab.id, url);
    const updateElapsedTimeSeconds = Math.round(
      +new Date() / 1000 - updateStartTimeSeconds,
    );
    if (newTab.url !== url) {
      console.log(
        `Failed to get URL ${url} in tab ${newTab.id} after ${updateElapsedTimeSeconds} seconds; have ${newTab.url}`,
      );
      return false;
    } else {
      console.log(
        `Got expected URL ${url} after ${updateElapsedTimeSeconds} seconds`,
      );
    }
    await chrome.scripting.executeScript({
      target: { tabId: newTab.id },
      func: fullyLoaded,
    });
    const blob = await chrome.pageCapture.saveAsMHTML({ tabId: newTab.id });
    const content = await blob.text();
    const match =
      /Snapshot-Content-Location: (https:\/\/groups\.google\.com\/g\/[^\/]+\/c\/[^\r\n]+)/.exec(
        content,
      );
    if (!match) {
      console.log(
        `Did not find Snapshot-Content-Location in download for ${url}`,
      );
      return false;
    }
    if (match[1] !== url) {
      console.log(`Download URL <${match[1]}> does not match <${url}>`);
      return false;
    }
    const dataUrl = "data:application/x-mimearchive;base64," + btoa(content);
    const postName = url.split("/").pop();
    await chrome.downloads.download({
      url: dataUrl,
      filename: `${postName}.mhtml`,
    });
  } catch (error) {
    console.log(`Failed to download ${url}`, error, error.stack);
    return false;
  }
  return true;
}

document.getElementById("start-button").addEventListener("click", async () => {
  const maxDownloadsInput = document.getElementById("max-downloads");
  if (!maxDownloadsInput) {
    console.log("Missing max-downloads input!");
    return;
  }
  const maxDownloads = parseInt(maxDownloadsInput.value);
  console.log(`Limit to max-downloads: ${maxDownloads}`);
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  // We do the max downloads limiting when getting the list of URLs because
  // getting the URLs itself requires hitting the remote servers. Best to be
  // as conservative as we can be with that.
  const urls = await getPostUrlsAcrossIndex(tab, maxDownloads);
  console.log(`Found ${urls.length} URLs`);
  document.getElementById("url-count").innerText = urls.length;
  console.log(`URLs: ${urls}`);
  document.getElementById("urls").value = urls.join("\n");
  const downloadCountDisplay = document.getElementById("download-count");
  const failedCountDisplay = document.getElementById("failed-count");
  const failedDownloadsInput = document.getElementById("failed-downloads");
  let downloadCount = 0;
  let numSuccesses = 0;
  let numFailures = 0;
  let failedUrls = [];
  for (let url of urls) {
    if (maxDownloads >= 0 && downloadCount >= maxDownloads) {
      console.log(`Hit max download limit: ${downloadCount}`);
      break;
    }
    console.log("Processing URL ", url);
    if (downloadCount > 0) {
      // Add some delay to be friendlier to Google's servers.
      await delay(7000 + 23000 * Math.random());
    }
    let successful = false;
    for (let tries = 0; tries < 3; tries++) {
      if (tries > 0) {
        await delay(500 + 1000 * Math.random());
      }
      successful = await downloadUrlCapture(tab, url);
      if (successful) {
        console.log(`Succeeded after ${tries + 1} attempt(s)`);
        break;
      } else {
        console.log(`Attempt #${tries + 1} for ${url} failed`);
      }
    }
    if (!successful) {
      console.log(`All attempts for ${url} failed.`);
      numFailures++;
      failedCountDisplay.innerText = numFailures;
      failedUrls.push(url);
      failedDownloadsInput.value = failedUrls.join("\n");
    } else {
      numSuccesses++;
      downloadCountDisplay.innerText = numSuccesses;
    }
    downloadCount++;
    console.log(`Finished with download #${downloadCount}`);
  }
  console.log(`Num successful: ${numSuccesses}`);
  console.log(`Num failures: ${numFailures}`);
  console.log("Failed URLs", failedUrls);
  document.getElementById("message").innerText = "Done!";
});
