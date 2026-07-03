document.addEventListener("DOMContentLoaded", () => {
  document.body.classList.add("page-ready");
  initGiftPage();
});

const SUPABASE_URL = "https://umtqpstacjdwxcvcirbl.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_PtWhyYhKGUVxph4o80oGbg_aeZVnUyk";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const USER_TABLE = "users";

const refs = {
  redeemButtons: [],
  pointCountEl: document.getElementById("pointCount"),
  ticketCountEl: document.getElementById("ticketCount"),
  giftListEl: document.getElementById("giftList"),
  giftStatusEl: document.getElementById("giftStatus")
};

function getUserProfile() {
  return window.UserStore?.getUserProfile
    ? window.UserStore.getUserProfile()
    : { userId: "", nickname: "" };
}

function getGiftData() {
  return window.GIFT_DATA || window.GiftData || [];
}

function setStatus(message) {
  if (refs.giftStatusEl) {
    refs.giftStatusEl.textContent = message;
  }
}

async function fetchRemoteUser() {
  const profile = getUserProfile();

  if (!profile.userId) {
    throw new Error("找不到 userId");
  }

  const { data, error } = await supabaseClient
    .from(USER_TABLE)
    .select("user_id,nickname,points,tickets")
    .eq("user_id", profile.userId)
    .maybeSingle();

  if (error) {
    console.error("[gift debug] fetchRemoteUser error =", error);
    throw new Error(error.message || "讀取使用者失敗");
  }

  if (!data) {
    throw new Error("Supabase 找不到這個使用者");
  }

  console.log("[gift debug] fetchRemoteUser user =", data);
  return data;
}

function renderTopbar(remoteUser) {
  const points = Number(remoteUser?.points || 0);
  const tickets = Number(remoteUser?.tickets || 0);

  if (refs.pointCountEl) refs.pointCountEl.textContent = points;
  if (refs.ticketCountEl) refs.ticketCountEl.textContent = tickets;

  console.log("[gift debug] renderTopbar =", { points, tickets });
}

async function refreshTopbarFromRemote() {
  try {
    const remoteUser = await fetchRemoteUser();
    renderTopbar(remoteUser);
    return remoteUser;
  } catch (error) {
    console.error("[gift debug] refreshTopbarFromRemote failed =", error);
    setStatus(`讀取帳戶資料失敗：${error.message}`);
    throw error;
  }
}

async function adjustRemoteBalance({
  pointsDelta = 0,
  ticketsDelta = 0,
  note = "",
  giftId = "",
  giftName = ""
}) {
  const profile = getUserProfile();

  if (!profile.userId) {
    throw new Error("找不到 userId");
  }

  const user = await fetchRemoteUser();

  const currentPoints = Number(user.points || 0);
  const currentTickets = Number(user.tickets || 0);

  const nextPoints = currentPoints + Number(pointsDelta || 0);
  const nextTickets = currentTickets + Number(ticketsDelta || 0);

  if (nextPoints < 0) {
    throw new Error("點數不足");
  }

  if (nextTickets < 0) {
    throw new Error("抽獎券不足");
  }

  const { data, error } = await supabaseClient
    .from(USER_TABLE)
    .update({
      nickname: profile.nickname || user.nickname || "",
      points: nextPoints,
      tickets: nextTickets,
      updated_at: new Date().toISOString()
    })
    .eq("user_id", profile.userId)
    .select("user_id,nickname,points,tickets")
    .single();

  if (error) {
    console.error("[gift debug] adjustRemoteBalance error =", error);
    throw new Error(error.message || "更新點數失敗");
  }

  console.log("[gift debug] adjustRemoteBalance result =", data);

  renderTopbar(data);

  return {
    ok: true,
    user: data,
    message: "更新成功",
    giftId,
    giftName,
    note
  };
}
