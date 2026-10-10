var H = {};
var S = {
    "offset": 1,
    "hits": 50,
    "sort": "-birthday",
    "q": "",
    "age_min": "",
    "age_max": "",
    "height_min": "",
    "height_max": "",
    "bust_min": "",
    "bust_max": "",
    "waist_min": "",
    "waist_max": "",
    "hip_min": "",
    "hip_max": ""
};
var range = ["age", "height", "bust", "waist", "hip"];
var rangeo = {
    "age": { n: "年齢" },
    "height": { n: "身長" },
    "bust": { n: "バスト" },
    "waist": { n: "ウエスト" },
    "hip": { n: "ヒップ" }
};
var minmax = ["min", "max"];

var now = new Date();
var today = now.getFullYear() + ("0" + (now.getMonth() + 1)).slice(-2) + ("0" + now.getDate()).slice(-2);
now.setDate(now.getDate() + 1);
var tomorrow = now.getFullYear() + ("0" + (now.getMonth() + 1)).slice(-2) + ("0" + now.getDate()).slice(-2);

$(function () {
    loadParam();
    setForm();
    getData();

    $(document)
        .on("click", "#sbmt", function () {
            S.offset = 1;
            getData();
        })
        .on("change", "#sort", function () {
            S.offset = 1;
            S.sort = $(this).val();
            getData();
        })
        .on("click", ".paging a", function () {
            S.offset = ($(this).data("page") - 1) * S.hits + 1;
            getData();
        })
        .on("click", ".frmtoggle", function () {
            $("body").toggleClass("frmshow");
        })
        .on("click", ".condition", function () {
            $("body").addClass("frmshow");
            location.href = "#";
        });
});

// URLパラメータの読み込み
function loadParam() {
    try {
        var searchParams = new URLSearchParams(decodeURIComponent(location.search).replace(/&amp;/g, "&"));
        searchParams.forEach((value, key) => {
            S[key] = decodeURIComponent(value);
        });

        var hashParams = new URLSearchParams(decodeURIComponent(location.hash.slice(1)).replace(/&amp;/g, "&"));
        hashParams.forEach((value, key) => {
            H[key] = decodeURIComponent(value);
        });
        return true;
    } catch (e) {
        window.location.href = "/";
    }       
}

// フォームに値を設定
function setForm() {
    Object.keys(S).forEach(function (key) {
        $("#" + key).val(decodeURIComponent(S[key]));
    });
}

// データ取得
function getData() {
    var page = {};

    $("#tbl tbody").html("<i class='loading'></i>");

    // ユーザー入力のminとmaxが逆になっていたら修正
    range.forEach(function (item) {
        var o_min = $("#" + item + "_min");
        var o_max = $("#" + item + "_max");
        if (o_min.val() != "" && o_max.val() != "" && (o_min.val() * 1 > o_max.val() * 1)) {
            var tmp = o_min.val();
            o_min.val(o_max.val());
            o_max.val(tmp);
        }
    });

    if ($("#q").val() != "") {
        $("#q").val($("#q").val().replace(/^[ 　]+/, "").replace(/[ 　]+$/, ""));
    }

    var param = {
        "api_id": "cKLxQzpehtWUh0bpBvTZ",
        "affiliate_id": "joyusexy-990",
        "output": "json",
        "hits": S.hits,
        "offset": S.offset,
        "keyword": "",
        "bust": $("#bust_min").val(),
        "waist": $("#waist_min").val(),
        "hip": $("#hip_min").val(),
        "height": $("#height_min").val(),
        "birthday": "",
        "sort": $("#sort").val()
    };

    if ($("#q").val() != "") param["keyword"] = encodeURIComponent($("#q").val());
    if ($("#age_max").val() != "") param["birthday"] = tomorrow - ($("#age_max").val() * 1 + 1) * 10000;
    if ($("#age_min").val() != "") param["birthday"] += "-" + (tomorrow - $("#age_min").val() * 10000);
    if ($("#height_max").val() != "") param["height"] += "-" + $("#height_max").val();
    if ($("#bust_max").val() != "") param["bust"] += "-" + $("#bust_max").val();
    if ($("#waist_max").val() != "") param["waist"] += "-" + $("#waist_max").val();
    if ($("#hip_max").val() != "") param["hip"] += "-" + $("#hip_max").val();

    $.ajax({
        cache: true,
        dataType: "jsonp",
        data: param,
        url: "https://api.dmm.com/affiliate/v3/ActressSearch"
    }).done(function (d) {
        if (d.result.status != 200) {
            $("#tbl tbody").html("<div class='mes error'>エラーが発生しました。<br>しばらく時間をおいて再度お試しください。</div>");
        } else {
            if (d.result.total_count == 0) {
                $("#tbl tbody").html("<div class='mes zero'>条件に当てはまる女優さんは見つかりませんでした</div>");
            } else {
                var tbodyTxt = d.result.actress.map(function (item) {
                    var trTxt = [];
                    var age = "";
                    if (item.birthday) {
                        age = Math.floor((today - item.birthday.replace(/\-/g, "") * 1) / 10000);
                    }

                    if (age >= 18 || age == "") {
                        trTxt.push("<tr>");
                        item.imageURL ? trTxt.push("<td class='image'><img src='" + item.imageURL.large.replace("http://","https://") + "' alt='" + item.name + "の顔写真'></td>") : trTxt.push("<td class='image'><img src='https://joyu.sexy/img/default.svg' alt='顔写真なし'></td>");
                        trTxt.push("<td class='name ec'><h2><ruby>" + item.name);
                        item.name != item.ruby ? trTxt.push("<rt>" + item.ruby + "</rt>") : trTxt.push("<rt>　</rt>");
                        trTxt.push("</ruby></h2></td>");
                        item.birthday ? trTxt.push("<td class='age ec ctxt'>" + age + "</td>") : trTxt.push("<td class='age ctxt'></td>");
                        item.height ? trTxt.push("<td class='height ec ctxt'>" + item.height + "</td>") : trTxt.push("<td class='height ctxt'></td>");
                        item.cup ? trTxt.push("<td class='cup ec ctxt'>" + item.cup + "</td>") : trTxt.push("<td class='cup ctxt'></td>");
                        item.bust ? trTxt.push("<td class='bust ec ctxt'>" + item.bust + "</td>") : trTxt.push("<td class='bust ctxt'></td>");
                        item.waist ? trTxt.push("<td class='waist ec ctxt'>" + item.waist + "</td>") : trTxt.push("<td class='waist ctxt'></td>");
                        item.hip ? trTxt.push("<td class='hip ec ctxt'>" + item.hip + "</td>") : trTxt.push("<td class='hip ctxt'></td>");
                        item.birthday ? trTxt.push("<td class='birthday ec ctxt'>" + item.birthday + "</td>") : trTxt.push("<td class='birthday ctxt'></td>");
                        item.blood_type ? trTxt.push("<td class='blood_type ec ctxt'>" + item.blood_type + "</td>") : trTxt.push("<td class='blood_type ctxt'></td>");
                        item.prefectures ? trTxt.push("<td class='prefectures ec'>" + item.prefectures + "</td>") : trTxt.push("<td class='prefectures'></td>");
                        item.hobby ? trTxt.push("<td class='hobby ec'>" + item.hobby + "</td>") : trTxt.push("<td class='hobby'></td>");
                        trTxt.push("<td class='outlink'><a href='" + item.listURL.digital + "' target='_blank' title='" + item.name + " " + item.ruby + "'><i class='material-icons'>&#xE5CC;</i></a></td>");
                    } else {
                        d.result.total_count--;
                    }
                    return trTxt.join("");
                });
                $("#tbl tbody").html(tbodyTxt.join(""));
            }

            // 合計件数
            var num_s = $(".count strong").html() * 1;
            var num_e = d.result.total_count;
            var num_i = Math.round((num_e - num_s) / 10);
            var num_t = setInterval(function () {
                num_s += num_i;
                if ((num_i > 0 && num_s >= num_e) || (num_i < 0 && num_s <= num_e)) {
                    clearInterval(num_t);
                    $(".count strong").html(num_e);
                } else {
                    $(".count strong").html(num_s);
                }
            }, 30);

            // ページング
            var paging = [];
            page.cur = Math.ceil(S.offset / S.hits);
            page.last = Math.ceil(d.result.total_count / S.hits);
            if (page.last > 1) {
                if (page.cur > 1) {
                    paging.push("<li class='prevpage'><a href='javascript:void(0)' data-page='" + (page.cur - 1) + "'><i class='material-icons'>&#xE5CB;</i></a>");
                }
                if (page.cur > 2) {
                    paging.push("<li class='firstpage'><a href='javascript:void(0)' data-page='1'>1</a>");
                    if (page.cur > 3) {
                        paging.push("<li>..");
                    }
                }
                for (var i = Math.max(1, page.cur - 1); i < page.cur; i++) {
                    paging.push("<li><a href='javascript:void(0)' data-page='" + i + "'>" + i + "</a>");
                }
                paging.push("<li class='cur'><a>" + page.cur + "</a>");
                for (var i = page.cur + 1; i <= Math.min(page.last, page.cur + 1); i++) {
                    paging.push("<li><a href='javascript:void(0)' data-page='" + i + "'>" + i + "</a>");
                }
                if (page.cur + 1 < page.last) {
                    if (page.cur < page.last-2) {
                        paging.push("<li>..");
                    }
                    paging.push("<li class='lastpage'><a href='javascript:void(0)' data-page='" + page.last + "'>" + page.last + "</a>");
                }
                if (page.cur < page.last) {
                    paging.push("<li class='nextpage'><a href='javascript:void(0)' data-page='" + (page.cur + 1) + "'><i class='material-icons'>&#xE5CC;</i></a>");
                }
                $(".paging").html(paging.join("")).show();
            } else {
                $(".paging").hide();
            }

            // title, h1 書き換え
            var title = range.map(function (item) {
                if ($("#" + item + "_min").val() != "" || $("#" + item + "_max").val() != "") {
                    return rangeo[item].n + $("#" + item + "_min").val() + "～" + $("#" + item + "_max").val();
                }
            }).filter(Boolean);

            if ($("#q").val() != "") {
                title.push("名前に「" + $("#q").val() + "」を含む");
            }

            if (title.length > 0) {
                $("title, main>h1").html(title.join("、") + " (" + page.cur + "/" + page.last + ") - AV女優データベース");
                $(".condition").html("<li>" + title.join("<li>")).addClass("show");
            } else {
                $("title, main>h1").html("AV女優" + d.result.total_count + "人のプロフィール - AV女優データベース");
                $(".condition").removeClass("show");
            }

            // URL書き換え
            var query = Object.keys(S).map(function (key) {
                return key + "=" + ($("#" + key).val() != undefined ? $("#" + key).val() : S[key]);
            });

            var normalized = "?" + query.sort().join("&");
            $("head").append('<link rel="canonical" href="https://joyu.sexy/' + normalized + '">');
            $("head").append('<meta property="og:url" content="https://joyu.sexy/' + normalized + '">');

            if (history && history.replaceState) {
                history.replaceState(null, title.join("、") + " - AV女優データベース", normalized);
            }
            location.href = "#";
        }
    });

    // モバイルで検索フォームを非表示にする
    $("body").removeClass("frmshow");
}