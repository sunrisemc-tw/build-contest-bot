const mysql = require('mysql');
const crypto = require('crypto');

require('dotenv').config();

const { 
  Client, 
  ActivityType,
  GatewayIntentBits,
  Partials, 
  ButtonBuilder, 
  ButtonStyle, 
  ActionRowBuilder, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle,
  ChannelType
} = require('discord.js');

const client = new Client({ intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.DirectMessages,  
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
    ], 
    partials: [Partials.Channel, Partials.Message]}
);

const token= process.env.DISCORD_TOKEN;
const discord_channel= process.env.DISCORD_CHANNEL;
const mysql_ip = process.env.SQL_ADDRESS;
const mysql_db = process.env.SQL_DATABASE;
const mysql_user = process.env.SQL_USER;
const mysql_password = process.env.SQL_PASSWORD;
const discord_score_role = JSON.parse(process.env.DISCORD_SCORE_ROLE);
const vote_start = parseInt(process.env.VOTE_START);
const vote_end = parseInt(process.env.VOTE_END);

var con = mysql.createConnection({
  host: mysql_ip,
  user: mysql_user,
  password: mysql_password,
  database: mysql_db,
  charset: 'utf8mb4', 
  multipleStatements: true
});

con.connect((err) => {
  if (err) {
    console.error('error connecting: ' + err.stack);
    return;
  }
 
  console.log('connected as id ' + con.threadId);
});

function hasRole (data, user) {
    for (let i = 0; i < user.length; i++) {
        const element = user[i];
        if(data.includes(element)) return true;
    }
    return false;
}

async function total(scoreDic, interaction) {
    let adminTotalScore = 0;
    
    // scoreDic 格式為 { "admin_id": 85, ... }
    for (const adminId in scoreDic) {
        try {
            const member = await interaction.guild.members.fetch(adminId);
            const memberRoleIds = member.roles.cache.map(r => r.id);
            const scoreGiven = scoreDic[adminId]; // 管理員給的原始分

            // 尋找該管理員擁有的最高權重角色
            let weight = 0;
            for (const roleId in discord_score_role) {
                if (memberRoleIds.includes(roleId)) {
                    // 取得該角色的加權倍率 (例如 11 或 30)
                    const currentWeight = discord_score_role[roleId];
                    if (currentWeight > weight) weight = currentWeight;
                }
            }
            
            // 這裡假設：總分 = (權重 * 分數) 的累加
            // 或者你可以自定義權重如何影響分數
            adminTotalScore += (weight / 100 * scoreGiven);
        } catch (e) {
            console.error(`無法獲取管理員 ${adminId} 的資訊`);
        }
    }
    return adminTotalScore;
}

client.on("ready", async () => {
  console.log(`bot on -> @${client.user.tag}`);
  client.user.setActivity("我好建", { type: ActivityType.Playing });
})

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (!message.guild) {
        console.log(`收到來自 ${message.author.tag} 的私訊：${message.content}`);

        const patterns = {
            name: /建築名稱[:：](.*)/,
            description: /建築說明[:：](.*)/,
            coordinates: /建築座標[:：](.*)/
        };

        const info = {};

        for (const [key, reg] of Object.entries(patterns)) {
            const match = message.content.match(reg);
            if(match) {
                info[key] = match[1].trim()
            } else {
                message.reply(`
> 投稿失敗：請依照正確格式填寫！
範例：
\`\`\`
建築名稱：為您的建築取的名(不可換行)
建築說明：請簡單描述您的作品(不可換行)
建築座標：X Y Z座標

[+] 附加圖片
\`\`\`
`)
                    
                return
            }
        }

        info['id'] = crypto.randomUUID();
        let attachments = Array.from(message.attachments.values());

        if (attachments.length >= 1) {
            const VoteButton = new ButtonBuilder()
                .setCustomId(JSON.stringify({"id": info.id, "action": "vote"}))
                .setLabel('投我一票')
                .setEmoji('🎫')
                .setStyle(ButtonStyle.Primary);

            const AdminButton = new ButtonBuilder()
                .setCustomId(JSON.stringify({"id": info.id, "action": "admin"}))
                .setLabel('管理操作')
                .setEmoji('🤫')
                .setStyle(ButtonStyle.Danger);

            const actionRow = new ActionRowBuilder()
                .addComponents(VoteButton)
                .addComponents(AdminButton);

            con.query('SELECT COUNT(*) AS count FROM build WHERE owner = ? AND available = FALSE;', [`<@${message.author.id}>`], async (err, result) => {
                const final = result[0].count > 0;

                if(final > 0) {
                    message.reply('> 由於您先前投稿之作品被判定為違規，因此不得投稿，如有異議請聯絡管理員！')
                } else {
                    const post = await client.channels.cache.get(discord_channel).send({
                        content: `# <a:3469pepeparty:1208317114679824394> 新建築來了！\n## 建築名稱 「${info.name}」\n## 建築說明 「${info.description}」`,
                        components: [actionRow],
                        files: attachments,
                        allowedMentions: { 
                            parse: [], 
                            repliedUser: false 
                        }
                    });

                    if(client.channels.cache.get(discord_channel).type == ChannelType.GuildAnnouncement) post.crosspost();

                    con.query(`INSERT INTO build (uuid, name, description, score, available, owner, vote, at, msgId) VALUES (?, ?, ?, '{}', true, ?, '[]', ?, ?)`, [info.id, info.name, info.description, `<@${message.author.id}>`, info.coordinates, post.id])

                    message.reply(`> 投稿成功！ [點此查看](${post.url})`)
                }
            })
        } else {
            message.reply("> 投稿失敗：請附上建築圖片！")
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    // Handle specific custom IDs
    const btn = JSON.parse(interaction.customId);
    if (btn.action === 'admin') {
        if(hasRole(Object.keys(discord_score_role), interaction.member.roles.cache.map(role => role.id))) {
            const messageId = interaction.message.id;
            const ScoreButton = new ButtonBuilder()
                .setCustomId(JSON.stringify({"id": btn.id, "action": "score"}))
                .setLabel('評分')
                .setEmoji('🧭')
                .setStyle(ButtonStyle.Primary);

            const GetScoreButton = new ButtonBuilder()
                .setCustomId(JSON.stringify({"id": btn.id, "action": "getscore"}))
                .setLabel('察看結果')
                .setEmoji('📱')
                .setStyle(ButtonStyle.Success);

            const DisableeButton = new ButtonBuilder()
                .setCustomId(JSON.stringify({"id": btn.id, "action": "disable", "msgId": messageId}))
                .setLabel('取消資格')
                .setEmoji('💣')
                .setStyle(ButtonStyle.Danger);

            const actionRow = new ActionRowBuilder()
                .addComponents(ScoreButton)
                .addComponents(GetScoreButton)
                .addComponents(DisableeButton);

            await interaction.reply({
                content: `> 管理員操作模式`,
                components: [actionRow],
                ephemeral: true
            });
        } else {
            interaction.reply({content: "> 錯誤：你不是管理員！", ephemeral: true})
        }
    } else if (btn.action === 'vote') {
        if (parseInt(Date.now() / 1000) >= vote_start && parseInt(Date.now() / 1000) <= vote_end) {
            con.query(`SET @target_uuid = ?;
SET @user_id = ?;

-- 0. 檢查目標建築的可用狀態
SET @is_available = (SELECT available FROM build WHERE uuid = @target_uuid COLLATE utf8mb4_unicode_ci);

-- 1. 計算票數上限
SET @max_tickets = (SELECT CEIL(COUNT(*) / 4) FROM build WHERE available = 1);

-- 2. 檢查使用者已投總票數 (跨所有建築)
SET @current_votes = (SELECT COUNT(*) FROM build WHERE JSON_CONTAINS(vote, JSON_QUOTE(@user_id)));

-- 3. 搜尋該使用者在「這棟建築」中的 JSON 路徑
SET @voted_path = (SELECT JSON_UNQUOTE(JSON_SEARCH(vote, 'one', @user_id)) FROM build WHERE uuid = @target_uuid COLLATE utf8mb4_unicode_ci);

-- 4. 執行條件更新 (加上 available = 1 的條件避免在禁用狀態下誤觸發)
UPDATE build 
SET vote = CASE 
    -- 如果建築被禁用，則不變動
    WHEN @is_available = 0 THEN vote
    -- 如果已經投過票，則移除該路徑的資料 (取消投票)
    WHEN @voted_path IS NOT NULL THEN JSON_REMOVE(vote, @voted_path)
    -- 如果沒投過且票數未滿，則新增 (新增投票)
    WHEN @current_votes < @max_tickets THEN JSON_ARRAY_APPEND(IFNULL(vote, '[]'), '$', @user_id)
    -- 否則維持原狀
    ELSE vote 
END
WHERE uuid = @target_uuid COLLATE utf8mb4_unicode_ci 
AND available = 1; -- 確保只更新可用的建築

-- 5. 回傳最終狀態
SELECT 
    CASE 
        WHEN @is_available = 0 THEN 'disabled'
        WHEN @voted_path IS NOT NULL THEN 'vote_cancelled'
        WHEN @current_votes >= @max_tickets THEN CONCAT('vote over ', CAST(@max_tickets AS CHAR))
        WHEN ROW_COUNT() > 0 THEN 'success'
        ELSE 'failed'
    END AS result;`, 
            [btn.id, interaction.user.id], (err, result) => {
                if (err || !result || !Array.isArray(result)) {
                    interaction.reply({content: `> 錯誤：發生未知錯誤，請將此訊息截圖告知管理員`, ephemeral: true})
                    return
                }
                
                const final = result[result.length - 1][0].result;
                
                if (final == 'success') {
                    interaction.reply({content: '> 投票成功！投票獎勵將於活動結束後進入帳戶', ephemeral: true});
                } else if (final == 'vote_cancelled') {
                    interaction.reply({content: '> 取消成功，您現在可以投其他作品了', ephemeral: true});
                } else if (final.startsWith('vote over ')) {
                    interaction.reply({content: `> 錯誤：您已投票超過 \`${final.replace('vote over ', '')}\` 票`, ephemeral: true});
                } else if (final == 'disabled'){
                    interaction.reply({content: '> 該作品已因違反規則而遭到取消資格', ephemeral: true});
                } else {
                    interaction.reply({content: `> 錯誤：發生未知錯誤，請將此訊息截圖告知管理員`, ephemeral: true});
                    console.log(err);
                    console.log(result);
                }
            })
        } else {
            interaction.reply({content: '> 錯誤：目前尚未開放投票！', ephemeral: true});
        }
    } else if (btn.action === 'score') {
        const modal = new ModalBuilder()
            .setCustomId(JSON.stringify({"id": btn.id, "action": "enterscore"}))
            .setTitle('評分系統');

        const ScoreInput = new TextInputBuilder()
            .setCustomId('score')
            .setLabel("請給予評分 1~100 分")
            .setStyle(TextInputStyle.Short);

        const actionRow = new ActionRowBuilder().addComponents(ScoreInput);

        modal.addComponents(actionRow);

        await interaction.showModal(modal);
    } else if (btn.action == "disable") {
        con.query(`SET @target_uuid = ?;

-- 先抓出作者是誰
SET @author = (SELECT owner FROM build WHERE uuid = @target_uuid COLLATE utf8mb4_unicode_ci);

-- 切換該作者所有建築的狀態
UPDATE build 
SET available = NOT available 
WHERE owner = @author;

-- 回傳結果 (包含所有作品的 msgId 與最新的狀態)
SELECT 
    msgId, 
    IF(available, 'enabled', 'disabled') AS status 
FROM build 
WHERE owner = @author;`, [btn.id], async (err, result) => {
            if (err || !result[3] || result[3].length === 0) {
                interaction.reply({content: '> 錯誤：找不到作品資料或發生資料庫錯誤', ephemeral: true});
                console.error(err);
                return;
            }

            const buildList = result[3]; // 取得該作者所有作品清單
            const finalStatus = buildList[0].status; // 因為是整批切換，狀態會是一樣的
            const warningText = '\n\n**⚠️ 該作品因違反規定已被取消資格！**';
            const channel = interaction.channel;

            try {
                // 使用 Promise.all 同時處理多個訊息更新，提高效率
                await Promise.all(buildList.map(async (build) => {
                    if (!build.msgId) return; // 避免沒有 msgId 的資料報錯
                    
                    try {
                        const message = await channel.messages.fetch(build.msgId);
                        let newContent = message.content;

                        if (finalStatus === 'enabled') {
                            // 恢復：移除警告文字
                            newContent = newContent.replace(warningText, '');
                        } else {
                            // 停權：若沒重複則加上警告文字
                            if (!newContent.includes(warningText)) {
                                newContent += warningText;
                            }
                        }
                        await message.edit({
                            content: newContent,
                            allowedMentions: { parse: [] }
                        });
                    } catch (e) {
                        console.log(`無法更新訊息 ${build.msgId}:`, e.message);
                    }
                }));

                const replyMsg = finalStatus === 'enabled' ? '> 該作者所有作品已恢復！' : '> 該作者所有作品已遭撤銷！';
                interaction.reply({content: replyMsg, ephemeral: true});

            } catch (error) {
                interaction.reply({content: '> 處理訊息時發生錯誤，請聯絡管理員', ephemeral: true});
                console.error(error);
            }
        });
    } else if (btn.action == 'getscore') {
        con.query(`SELECT * FROM build WHERE uuid=?;
SELECT JSON_LENGTH(vote) AS count FROM build WHERE JSON_LENGTH(vote) > 0;`, [btn.id], async (err, result) => {
    console.log(result);
    
            const final = result[0][0];
            const max_vote = result[1].length > 0 ? Math.max(result[1].map(row => row.count)) : 0;
            let min_vote = result[1].length > 0 ? Math.min(result[1].map(row => row.count)) : 0;

            if(max_vote == min_vote) min_vote -= 1;

            console.log(await total(JSON.parse(final.score), interaction));
            
            
            interaction.reply({
                content: `> 作品 ${final.name} 資訊
資格：${final.available ? '合格': '不合格'}
作者：${final.owner}
位置：${final.at}
票數：${JSON.parse(final.vote).length}
總分：${(JSON.parse(final.vote).length > 0 ? JSON.parse(final.vote).length * (10 / (max_vote - min_vote)) - 5 : 0) + await total(JSON.parse(final.score), interaction)} 分
                `, ephemeral: true
            })
        })
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;

    const model = JSON.parse(interaction.customId);
    if (model.action == "enterscore") {
        const score = parseInt(interaction.fields.getTextInputValue('score'));

        if(score >= 0 && score <= 100) {
            con.query(`UPDATE build SET score = JSON_SET(score, ?, ?) WHERE uuid=?`, [`$.${interaction.user.id}`, score, model.id], (err, result) => {
                if (!err && result.affectedRows > 0) {
                    interaction.reply({content: '> 評分成功送出！', ephemeral: true})
                } else {
                    interaction.reply({content: '> 錯誤：發生未知錯誤，請將此訊息截圖告知管理員', ephemeral: true});
                    console.log(err);
                    console.log(result);
                }     
            })
        } else {
            interaction.reply({content: '> 錯誤：分數應為0~100！', ephemeral: true})
        }
    }
})

client.login(token);
