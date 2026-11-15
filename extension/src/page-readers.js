// Lee publicaciones de Reddit y X tal como están cargadas en la pestaña: con tu sesión y sin pedir nada a esos servidores.
(function (root) {
  const clean = (value) => String(value || "").replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const absolute = (href) => { try { return href ? new URL(href, location.origin).href : ""; } catch { return ""; } };
  const httpUrl = (value) => (/^https?:\/\//.test(value || "") ? value : "");

  // ---------- Reddit (diseño actual, con elementos shreddit-*) ----------
  function redditPost(documentRef) {
    const post = documentRef.querySelector("shreddit-post");
    if (!post) return null;
    const body = post.querySelector('[slot="text-body"]');
    const image = post.querySelector('img[src*="preview.redd.it"], img[src*="i.redd.it"]');
    const subreddit = post.getAttribute("subreddit-prefixed-name") || "";
    const author = post.getAttribute("author") || "";
    return {
      id: (post.getAttribute("id") || "").replace(/^t3_/, ""),
      title: clean(post.getAttribute("post-title") || documentRef.title),
      author,
      subreddit,
      url: absolute(post.getAttribute("permalink")) || location.href,
      publishedAt: post.getAttribute("created-timestamp") || "",
      text: clean(body?.innerText || ""),
      imageUrl: httpUrl(image?.currentSrc || image?.src || ""),
    };
  }

  function redditCommentText(comment) {
    const body = comment.querySelector(':scope > [slot="comment"]') || comment.querySelector('[slot="comment"]');
    return clean(body?.innerText || "");
  }

  function redditCommentItem(comment) {
    const author = comment.getAttribute("author") || "";
    return {
      externalId: (comment.getAttribute("thingid") || "").replace(/^t1_/, ""),
      url: absolute(comment.getAttribute("permalink")),
      authorName: author ? `u/${author}` : "usuario eliminado",
      authorHandle: author,
      text: redditCommentText(comment),
      publishedAt: comment.querySelector("time")?.getAttribute("datetime") || comment.getAttribute("created") || "",
      depth: Number(comment.getAttribute("depth") || 0),
    };
  }

  function readRedditThread(documentRef) {
    const post = redditPost(documentRef);
    if (!post) return null;
    const first = { externalId: post.id, url: post.url, authorName: post.author ? `u/${post.author}` : "", authorHandle: post.author, text: [post.title, post.text].filter(Boolean).join("\n\n"), publishedAt: post.publishedAt, previewUrl: post.imageUrl, depth: 0 };
    const comments = [...documentRef.querySelectorAll("shreddit-comment")].map(redditCommentItem).filter((item) => item.text);
    return {
      kind: "reddit-thread",
      url: post.url,
      title: post.title,
      channel: [post.author && `u/${post.author}`, post.subreddit].filter(Boolean).join(" · "),
      description: post.text.slice(0, 2_000) || comments[0]?.text.slice(0, 600) || "",
      imageUrl: post.imageUrl,
      publishedAt: post.publishedAt,
      items: [first, ...comments].slice(0, 400),
    };
  }

  function readRedditComment(comment, documentRef) {
    const post = redditPost(documentRef);
    const item = redditCommentItem(comment);
    if (!item.text) return null;
    // Las respuestas directas viajan con el comentario para no perder el contexto de la conversación.
    const replies = [...comment.querySelectorAll(":scope > shreddit-comment")].map(redditCommentItem).filter((reply) => reply.text).slice(0, 20);
    const firstLine = item.text.split("\n").find(Boolean) || item.text;
    return {
      kind: "reddit-comment",
      url: item.url || location.href,
      title: firstLine.length > 110 ? `${firstLine.slice(0, 107).trim()}…` : firstLine,
      channel: [item.authorName, post?.subreddit].filter(Boolean).join(" · "),
      description: item.text.slice(0, 2_000),
      imageUrl: "",
      publishedAt: item.publishedAt,
      parentTitle: post?.title || documentRef.title,
      parentUrl: post?.url || location.href,
      items: [item, ...replies],
    };
  }

  // ---------- X ----------
  function readTweetArticle(article) {
    const link = [...article.querySelectorAll('a[href*="/status/"]')].find((anchor) => anchor.querySelector("time"));
    const url = absolute(link?.getAttribute("href"));
    if (!url) return null;
    const nameLines = (article.querySelector('[data-testid="User-Name"]')?.innerText || "").split("\n").map((line) => line.trim()).filter(Boolean);
    const handle = (nameLines.find((line) => line.startsWith("@")) || "").replace(/^@/, "");
    const name = nameLines[0] && !nameLines[0].startsWith("@") ? nameLines[0] : handle;
    const photos = [...article.querySelectorAll('[data-testid="tweetPhoto"] img')].map((image) => httpUrl(image.currentSrc || image.src)).filter(Boolean);
    const video = article.querySelector('[data-testid="videoPlayer"] video, [data-testid="videoComponent"] video');
    const poster = httpUrl(video?.getAttribute("poster") || "");
    return {
      externalId: (url.match(/status\/(\d+)/) || [])[1] || "",
      url: url.replace(/\/(photo|video|analytics)\/.*$/, ""),
      authorName: name,
      authorHandle: handle,
      avatarUrl: httpUrl(article.querySelector('[data-testid="Tweet-User-Avatar"] img')?.src || ""),
      text: clean(article.querySelector('[data-testid="tweetText"]')?.innerText || ""),
      publishedAt: article.querySelector("time")?.getAttribute("datetime") || "",
      previewUrl: photos[0] || poster,
      photos,
      depth: 0,
    };
  }

  function tweetPayload(items, kind) {
    const first = items[0];
    const firstLine = first.text.split("\n").find(Boolean) || `Publicación de @${first.authorHandle}`;
    return {
      kind,
      url: first.url,
      title: firstLine.length > 110 ? `${firstLine.slice(0, 107).trim()}…` : firstLine,
      channel: first.authorHandle ? `${first.authorName} (@${first.authorHandle})` : first.authorName,
      description: items.map((item) => item.text).join("\n\n").slice(0, 3_000),
      imageUrl: first.previewUrl,
      publishedAt: first.publishedAt,
      items,
    };
  }

  function readTweet(article) {
    const item = readTweetArticle(article);
    return item && (item.text || item.previewUrl) ? tweetPayload([item], "tweet") : null;
  }

  // En la página de un tweet guarda también la continuación del hilo escrita por el mismo autor.
  function readXThread(documentRef) {
    const id = (location.pathname.match(/status\/(\d+)/) || [])[1];
    if (!id) return null;
    const items = [...documentRef.querySelectorAll('article[data-testid="tweet"]')].map(readTweetArticle).filter(Boolean);
    const startIndex = items.findIndex((item) => item.externalId === id);
    if (startIndex < 0) return null;
    const author = items[startIndex].authorHandle;
    const thread = [items[startIndex], ...items.slice(startIndex + 1).filter((item) => item.authorHandle === author)].slice(0, 25);
    return tweetPayload(thread, thread.length > 1 ? "x-thread" : "tweet");
  }

  function readStructuredPage(documentRef) {
    const host = location.hostname.replace(/^www\./, "");
    if (/(^|\.)reddit\.com$/.test(host) && /\/comments\//.test(location.pathname)) return readRedditThread(documentRef);
    if ((host === "x.com" || host === "twitter.com") && /\/status\//.test(location.pathname)) return readXThread(documentRef);
    return null;
  }

  root.LuminaPage = { readStructuredPage, readRedditComment, readTweet };
})(globalThis);
