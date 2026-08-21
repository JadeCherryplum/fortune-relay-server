const params = new URLSearchParams(window.location.search);
const stationId = params.get("station")?.trim();

const form = document.querySelector("#birth-form");
const birthDateInput = document.querySelector("#birth-date");
const submitButton = document.querySelector("#submit-button");
const retryButton = document.querySelector("#retry-button");
const stationLabel = document.querySelector("#station-label");
const message = document.querySelector("#message");

birthDateInput.max = new Date().toISOString().slice(0, 10);

function showMessage(text, type = "") {
  message.textContent = text;
  message.className = `message ${type}`.trim();
}

function showUnavailable(text) {
  form.hidden = true;
  retryButton.hidden = false;
  showMessage(text, "error");
}

async function loadStation() {
  retryButton.hidden = true;
  showMessage("체험 화면의 상태를 확인하고 있습니다.");

  if (!stationId) {
    stationLabel.textContent = "올바른 QR 코드로 접속해 주세요.";
    return showUnavailable("체험 화면 정보가 없습니다.");
  }

  try {
    const response = await fetch(`/api/stations/${encodeURIComponent(stationId)}/status`, {
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.code || "REQUEST_FAILED");

    stationLabel.textContent = payload.station.displayName;
    if (payload.station.available) {
      form.hidden = false;
      showMessage("입력 버튼을 누르는 순간 사용 가능 여부를 최종 확인합니다.");
    } else {
      const text =
        payload.station.status === "offline"
          ? "현재 체험 화면과 연결할 수 없습니다."
          : "현재 다른 사용자가 체험 중입니다.";
      showUnavailable(text);
    }
  } catch {
    stationLabel.textContent = "연결을 확인해 주세요.";
    showUnavailable("서버 상태를 확인하지 못했습니다.");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!birthDateInput.reportValidity()) return;

  submitButton.disabled = true;
  showMessage("입력 정보를 전송하고 있습니다.");

  try {
    const response = await fetch(`/api/stations/${encodeURIComponent(stationId)}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ birthDate: birthDateInput.value }),
    });
    const payload = await response.json();

    if (response.ok && payload.accepted) {
      form.hidden = true;
      retryButton.hidden = true;
      stationLabel.textContent = payload.displayName;
      showMessage("접수가 완료되었습니다. 앞의 화면에서 결과를 확인해 주세요.", "success");
      return;
    }

    if (response.status === 409) {
      return showUnavailable("다른 사용자의 입력이 먼저 접수되었습니다.");
    }
    if (response.status === 422) {
      throw new Error("INVALID_BIRTH_DATE");
    }
    throw new Error(payload.error?.code || "REQUEST_FAILED");
  } catch (claimError) {
    showMessage(
      claimError.message === "INVALID_BIRTH_DATE"
        ? "올바른 생년월일을 입력해 주세요."
        : "전송하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      "error",
    );
  } finally {
    submitButton.disabled = false;
  }
});

retryButton.addEventListener("click", loadStation);
loadStation();
