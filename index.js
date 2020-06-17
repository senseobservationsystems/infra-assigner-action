const github = require('@actions/github')
const core = require('@actions/core')

function isPriority(label) {
    return label.startsWith("Priority:");
}

function isComponent(label){
    return label.startsWith("Component:");
}

function getPriority(issue) {
    let labels = getLabel(issue);
    let priority_label = labels.filter(isPriority)[0];
    if (priority_label) {
        return priority_label.split(":")[1].trim();
    }
}

function getLabel(issue) {
    let labels = [];
    issue.labels.forEach(function(item, idx, array) {
        labels.push(item.name);
    });

    return labels;
}

function checkExperts(labels) {

    experts = {
        "Component: postgres-analytics": "maulanasly",
    }

    for (const item in experts) {
        if (labels.includes(item)){
            let expert = experts[item];
            return expert;
        }        
    }
    return;
}


async function checkRelatedProblem(issue) {

    const token = core.getInput('token');
    
    const octokit = github.getOctokit(token);

    let labels = getLabel(issue);
    let related_problems = [];
    
    let related_labels = labels.filter(isComponent);

    for await (const label of related_labels) {
        let query_label = ["problem",label].join(",");
        const {data: issues} = await octokit.issues.listForRepo({
            owner: 'senseobservationsystems',
            repo: 'infrastructure',
            labels: query_label
        });

        for await (const related_issue of issues) {
            if (related_issue.number !== issue.number) {
                related_problems.push(related_issue.assignee.login);
            }
        }
    }

    return related_problems;
}

async function checkCurrentLoadForUser(user) {

    const token = core.getInput('token');
    
    const octokit = github.getOctokit(token);

    let retval = {
        total: 0,
        highestPriority: "P5"
    }
    
    const {data: issues} = await octokit.issues.listForRepo({
        owner: 'senseobservationsystems',
        repo: 'infrastructure',
        assignee: user,
        labels: "problem"
    });

    for await (const issue of issues) {
        // console.log("Title:", issue.title)
                            
        retval.total += 1;

        let priority = getPriority(issue);
        // console.log("Priority:", priority)
        if (priority <= retval.highestPriority) {
            retval.highestPriority = priority;
        }

        // console.log("Total:", retval.total)
        // console.log("Highest Priority:", retval.highestPriority);
    }

    return retval;
}

function getMemberWithLowestPriority(teamLoad) {
    let lowestPriority = {
        priority: "P1",
        teamMember: []
    }

    for (const member in teamLoad) {
        let memberLoad = teamLoad[member];
        if(memberLoad.highestPriority == lowestPriority.priority){
            lowestPriority.teamMember.push(member)
        } else if (memberLoad.highestPriority > lowestPriority.priority){
            lowestPriority.priority = memberLoad.highestPriority;
            lowestPriority.teamMember = [member];
        }
    }

    for (const member in teamLoad) {
        let memberLoad = teamLoad[member]
    }

    return lowestPriority;
}

function getMemberWithLeastProblem(teamLoad) {
    let leastProblemNumber;
    let leastProblemMember;
    for (const member in teamLoad) {
        if (!leastProblemNumber) {
            leastProblemNumber = teamLoad[member].total;
            leastProblemMember = member;
        } else if (leastProblemNumber > teamLoad[member].total) {
            leastProblemNumber = teamLoad[member].total;
            leastProblemMember = member;
        }
    }

    return leastProblemMember;
}

async function getAssignee() {
    console.log("Start");

    const issue = github.context.payload.issue;

    console.log("Title:",issue.title);

    const labels = getLabel(issue);
    console.log("Labels:",labels);
    const issuePriority = getPriority(issue);

    const teamMembers = {
        orhan89: "P1",
        ridwanbejo: "P1",
        maulanasly: "P1",
        "rheza-sense": "P1",
        jeffryadityatama: "P4"
    }

    const eligible_engineer = Object.keys(teamMembers).filter(function(member){
        return (teamMembers[member] <= issuePriority);
    });

    console.log("Eligible engineer:", eligible_engineer);
    
    console.log("Checking on experts");
    
    let expert = checkExperts(labels);

    if (expert){
        console.log("Expert found:", expert);
        return {assignee: expert, reason:"Is expert on the related component"};
    } else {
        console.log("No Experts Found.")
    }

    console.log("Checking Team Member assigned to related problem.");

    let relatedProblems = await checkRelatedProblem(issue);

    if (relatedProblems.length > 0){
        console.log("Found team member(s) currently assigned to related problems:", relatedProblems);
        return {assignee: relatedProblems[0], reason: "Currently assigned to related component"};
    } else {
        console.log("No team member currently assigned to related problems.");
    }

    console.log("Checking team member assigned to lower priority.");
    
    let teamLoad = {};

    for await (const member of eligible_engineer) {
        let memberLoad = await checkCurrentLoadForUser(member);
        teamLoad[member] = memberLoad;
    }

    console.log(teamLoad);

    let lowestPriority = getMemberWithLowestPriority(teamLoad);
    console.log(lowestPriority);

    if (lowestPriority.priority > issuePriority) {
        if (lowestPriority.teamMember.length == 1) {
            console.log("Found A team member is assigned to lower priority problem:", lowestPriority.teamMember[0]);
            return {assignee: lowestPriority.teamMember[0], reason: "Currently assigned to lower priority problem"};
        } else {
            console.log("Found Multiple team member is assigned to lower priority problem:", lowestPriority.teamMember);
            console.log("Picking one with least number of problem");

            let leastProblemNumber;
            let leastProblemMember;
            lowestPriority.teamMember.forEach(function(member, idx, arr) {
                if (!leastProblemNumber) {
                    leastProblemNumber = teamLoad[member].total;
                    leastProblemMember = member;
                } else if (leastProblemNumber > teamLoad[member].total) {
                    leastProblemNumber = teamLoad[member].total;
                    leastProblemMember = member;
                }
            });

            console.log("Get one with least number of problem:", leastProblemMember, "(",leastProblemNumber," problems)");
            return {assignee: leastProblemMember, reason:"Currently assigned to lower priority problem, and assigned to least number of problems"};
        }
    } else {
        console.log("No team member currently assigned to lower priority");
    }

    console.log("Checking team member with the least number of problem");

    let leastProblemMember = getMemberWithLeastProblem(teamLoad);

    console.log("Team Member with least number of problems:", leastProblemMember);
    return {assignee: leastProblemMember, reason: "Assigned to least number of problems"};
}

async function run() {
    let {assignee, reason} = await getAssignee();
    const body = "Recommended Assignee: @" + assignee + "\nReason: " + reason;
    console.log(body);

    const token = core.getInput('token');
    
    const octokit = github.getOctokit(token);

    octokit.issues.createComment({
        owner: 'senseobservationsystems',
        repo: 'infrastructure',
        issue_number: github.context.payload.issue.number,
        body: body
    });

    octokit.issues.addAssignees({
        owner: 'senseobservationsystems',
        repo: 'infrastructure',
        issue_number: github.context.payload.issue.number,
        assigness: assignee
    });
}

run();
